import { existsSync, realpath as realpathRappel, realpathSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { promisify } from 'node:util'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { readBoundedUtf8FileWithin } from './bounded-file-read'
import { AUTOWIN_WORKSPACE_ENV, legacyWorkspaceEnvName } from '../shared/app-identity'
import { teamWorkspaces } from './brain-paths'
import {
  loadProjectContext,
  PROJECT_CONTEXT_CHAIN,
  PROJECT_CONTEXT_MAX_BYTES
} from './context-files'

export type BehaviourEngine = 'codex' | 'claude' | 'autowin'
export type BehaviourState = 'active' | 'conditional' | 'shadowed' | 'declared' | 'injected'
export type BehaviourScope = 'global' | 'workspace' | 'project' | 'skill'

export interface BehaviourQuery {
  workspaceRoot?: string
  contextRoot?: string
  homeRoot?: string
  localAppDataRoot?: string
}

export interface BehaviourFile {
  id: string
  label: string
  path: string
  engine: BehaviourEngine
  state: BehaviourState
  scope: BehaviourScope
  reason: string
  injectedAt: string
  injectedInto: string
  active: boolean
  size: number
}

const MAX_FILES = 500
const MAX_DIRECTORIES = 5_000
const MAX_SCAN_DEPTH = 5
const MAX_BYTES = 512_000
const EXCLUDED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  'audit',
  'dist',
  'build',
  'out',
  '.cache',
  'cache',
  'plugins',
  '.vs',
  '.idea',
  'bin',
  'obj',
  'packages'
])

export function defaultBehaviourWorkspace(): string {
  const configured = process.env[AUTOWIN_WORKSPACE_ENV] ?? process.env[legacyWorkspaceEnvName()]
  if (configured && existsSync(configured)) return resolve(configured)
  // Repli d'entreprise : le PREMIER workspace connu qui existe reellement sur cette machine. La liste
  // vient de la source unique `brain-paths.ts` (surchargeable) — avant, `C:\Code Projet` etait ecrit en
  // dur ici, donc l'app n'avait aucun repli utilisable ailleurs que sur les postes d'origine.
  const teamWorkspace = teamWorkspaces().find((candidate) => existsSync(candidate))
  return teamWorkspace ?? process.cwd()
}

function normalizeQuery(query?: string | BehaviourQuery): Required<BehaviourQuery> {
  const input =
    typeof query === 'string' ? { workspaceRoot: query, contextRoot: query } : (query ?? {})
  const requestedWorkspace = resolve(input.workspaceRoot ?? defaultBehaviourWorkspace())
  const workspaceRoot = existsSync(requestedWorkspace)
    ? realpathSync(requestedWorkspace)
    : requestedWorkspace
  const requestedContext = resolve(input.contextRoot ?? workspaceRoot)
  const contextRoot =
    pathInsideLexically(requestedContext, workspaceRoot) &&
    canonicalInside(requestedContext, workspaceRoot)
      ? realpathSync(requestedContext)
      : workspaceRoot
  const homeRoot = resolve(input.homeRoot ?? homedir())
  const localAppDataRoot = resolve(
    input.localAppDataRoot ??
      (input.homeRoot
        ? join(homeRoot, 'AppData', 'Local')
        : (process.env.LOCALAPPDATA ?? join(homeRoot, 'AppData', 'Local')))
  )
  return { workspaceRoot, contextRoot, homeRoot, localAppDataRoot }
}

function pathInsideLexically(path: string, root: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function canonicalInside(path: string, root: string): boolean {
  if (!existsSync(path) || !existsSync(root)) return false
  const rel = relative(realpathSync(root), realpathSync(path))
  return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`))
}

function scopeFor(path: string, query: Required<BehaviourQuery>, global = false): BehaviourScope {
  if (global) return 'global'
  return resolve(path) === query.workspaceRoot ? 'workspace' : 'project'
}

function instruction(
  path: string,
  engine: BehaviourEngine,
  state: BehaviourState,
  scope: BehaviourScope,
  reason: string
): BehaviourFile {
  const injectedAt =
    engine === 'codex'
      ? state === 'shadowed'
        ? 'Jamais : Codex ne charge pas ce fichier'
        : 'Au démarrage de la session Codex'
      : engine === 'claude'
        ? state === 'conditional'
          ? 'Lorsque Claude travaille dans ce sous-arbre'
          : state === 'shadowed'
            ? // Ne PAS annoncer une injection pour un fichier désarmé : c'est ce libellé, autant que
              // l'état, qui faisait croire que la mémoire globale pilotait les agents d'Autowin.
              'Jamais : Autowin ne charge pas ce fichier'
            : 'Replié dans le prompt comme contexte projet'
        : scope === 'skill'
          ? 'À l’invocation de la skill'
          : state === 'injected'
            ? 'Replié dans le prompt de chaque tour du chat et de chaque étape lancée'
            : state === 'shadowed'
              ? 'Jamais : un autre fichier de la chaîne est replié à sa place'
              : 'Déclaré · injection non tracée'
  return {
    id: `${engine}:${scope}:${Buffer.from(realpathSync(path)).toString('base64url')}`,
    label: basename(path),
    path: realpathSync(path),
    engine,
    state,
    scope,
    reason,
    injectedAt,
    injectedInto:
      engine === 'codex'
        ? 'Instructions Codex'
        : engine === 'claude'
          ? 'Mémoire Claude'
          : state === 'injected'
            ? 'Contexte projet du prompt'
            : 'Configuration déclarée',
    active: state === 'active' || state === 'injected',
    size: statSync(path).size
  }
}

function ancestors(query: Required<BehaviourQuery>): string[] {
  if (!pathInsideLexically(query.contextRoot, query.workspaceRoot)) return [query.workspaceRoot]
  const result = [query.contextRoot]
  let cursor = query.contextRoot
  while (cursor !== query.workspaceRoot) {
    const parent = dirname(cursor)
    if (parent === cursor || !pathInsideLexically(parent, query.workspaceRoot)) break
    result.push(parent)
    cursor = parent
  }
  if (result[result.length - 1] !== query.workspaceRoot) result.push(query.workspaceRoot)
  return result.reverse()
}

function isExcluded(dir: string, workspaceRoot: string): boolean {
  const rel = relative(workspaceRoot, dir)
    .split(sep)
    .map((part) => part.toLowerCase())
  if (rel.some((part) => EXCLUDED_DIRECTORIES.has(part))) return true
  const claude = rel.indexOf('.claude')
  return claude >= 0 && rel[claude + 1] === 'worktrees'
}

function cappedBehaviourFiles(groups: BehaviourFile[][]): BehaviourFile[] {
  const selected: BehaviourFile[] = []
  const selectedIds = new Set<string>()
  const add = (file: BehaviourFile | undefined): void => {
    if (!file || selected.length >= MAX_FILES || selectedIds.has(file.id)) return
    selected.push(file)
    selectedIds.add(file.id)
  }

  // Reserve every engine and the active chain before conditional descendants can consume the cap.
  for (const group of groups) add(group[0])
  for (const group of groups) {
    for (const file of group) {
      if (file.active) add(file)
    }
  }

  // Le groupe Autowin n'a pas de cascade descendante : ses sources déclarées restent visibles d'abord.
  for (const file of groups.find((group) => group[0]?.engine === 'autowin') ?? []) add(file)

  const remaining = groups.map((group) => group.filter((file) => !selectedIds.has(file.id)))
  while (selected.length < MAX_FILES && remaining.some((group) => group.length > 0)) {
    for (const group of remaining) {
      add(group.shift())
      if (selected.length >= MAX_FILES) break
    }
  }
  return selected
}

/**
 * MÊME canonisation que `realpathSync`, sans bloquer. `fs/promises.realpath` est la version NATIVE :
 * sous Windows elle développe les noms courts (`PRENOM~1.NOM` → nom long), alors que `realpathSync`
 * (utilisé par `instruction()` et `normalizeQuery`) les garde. Mesuré le 2026-10-16 (conv-984) : avec
 * un TEMP en nom court, un fichier découvert et le même fichier vu par la chaîne portaient deux chemins
 * différents — doublon dans la vue, et 4 tests rouges de `behaviour-files.test.ts`.
 */
const realpathCommeSync = promisify(realpathRappel)

/**
 * Parcours ASYNCHRONE du workspace. Mesure (`gels.jsonl`, 2026-10-10 06:55) : la version
 * `readdirSync` a tenu le thread principal 2 860 ms pour 240 dossiers, pendant
 * `os:behaviourComposition` — l'app entiere figee. Memes bornes, meme ordre de visite.
 */
async function discover(root: string, names: ReadonlySet<string>): Promise<string[]> {
  if (!existsSync(root)) return []
  const normalizedNames = new Set([...names].map((name) => name.toLowerCase()))
  const files: string[] = []
  let visitedDirectories = 0
  const visit = async (dir: string, depth: number): Promise<void> => {
    if (
      files.length >= MAX_FILES ||
      visitedDirectories >= MAX_DIRECTORIES ||
      depth > MAX_SCAN_DEPTH ||
      isExcluded(dir, root)
    )
      return
    visitedDirectories += 1
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await visit(path, depth + 1)
      else if (
        entry.isFile() &&
        normalizedNames.has(entry.name.toLowerCase()) &&
        canonicalInside(path, root)
      )
        files.push(await realpathCommeSync(path))
    }
  }
  await visit(root, 0)
  return files
}

/**
 * Identité d'un fichier : forme native (nom long, casse réelle), sans casse sous Windows, où
 * `AGENTS.md` et `agents.md` désignent le MÊME fichier. `undefined` si le fichier est illisible.
 */
function cleFichier(path: string): string | undefined {
  try {
    const natif = realpathSync.native(path)
    return process.platform === 'win32' ? natif.toLowerCase() : natif
  } catch {
    return undefined
  }
}

const CODEX_FICHIERS_PROJET_COUPES =
  'Chargement automatique de Codex coupé (`project_doc_max_bytes=0`, providers/codex.ts)'

/**
 * Pourquoi un AGENTS.md DE PROJET n'atteint jamais Codex par lui-même, et qui le replie à sa place.
 *
 * conv-984 (2026-10-16) : ces fichiers s'affichaient « codex · active · Au démarrage de la session
 * Codex ». Or `codexExecSpec` lance TOUJOURS le CLI avec `-c project_doc_max_bytes=0` : Codex ne lit
 * aucun AGENTS.md de projet (ni `AGENTS.override.md`). Seul le fichier retenu par la chaîne d'Autowin
 * (`loadProjectContext` sur le dossier de travail) atteint le prompt, replié par Autowin.
 */
function raisonCodexProjet(path: string, cleReplieParAutowin: string | undefined): string {
  if (cleReplieParAutowin && cleFichier(path) === cleReplieParAutowin)
    return `${CODEX_FICHIERS_PROJET_COUPES} : Autowin le replie lui-même dans le prompt (entrée autowin)`
  if (basename(path).toLowerCase() === 'agents.override.md')
    return `${CODEX_FICHIERS_PROJET_COUPES}, et Autowin ne lit pas AGENTS.override.md : jamais chargé`
  return `${CODEX_FICHIERS_PROJET_COUPES} : Autowin ne le replie que si ce dossier devient le dossier de travail d’une conversation`
}

function codexFiles(
  query: Required<BehaviourQuery>,
  discovered: string[],
  gagnantAutowin: string | undefined
): BehaviourFile[] {
  const files: BehaviourFile[] = []
  const cleReplieParAutowin = gagnantAutowin
    ? cleFichier(join(query.contextRoot, gagnantAutowin))
    : undefined
  // Le GLOBAL (`~/.codex`) reste chargé par Codex : la clé ne coupe que la boucle des fichiers de
  // projet, le global est ajouté avant elle (codex-rs/core/src/agents_md.rs,
  // `load_project_instructions`, vérifié sur la v0.151.0 installée le 2026-10-16). Sa règle propre
  // tient toujours : `AGENTS.override.md` passe devant `AGENTS.md`.
  const globalDir = join(query.homeRoot, '.codex')
  const globalOverride = join(globalDir, 'AGENTS.override.md')
  const globalBase = join(globalDir, 'AGENTS.md')
  if (existsSync(globalOverride)) {
    files.push(
      instruction(
        globalOverride,
        'codex',
        'active',
        scopeFor(globalDir, query, true),
        'Priorité AGENTS.override.md'
      )
    )
    if (existsSync(globalBase))
      files.push(
        instruction(
          globalBase,
          'codex',
          'shadowed',
          scopeFor(globalDir, query, true),
          'Masqué par AGENTS.override.md'
        )
      )
  } else if (existsSync(globalBase)) {
    files.push(
      instruction(
        globalBase,
        'codex',
        'active',
        scopeFor(globalDir, query, true),
        'Applicable au contexte sélectionné'
      )
    )
  }
  // Fichiers de PROJET (ancêtres du contexte, puis contextes imbriqués) : jamais lus par Codex.
  for (const dir of ancestors(query)) {
    for (const nom of ['AGENTS.override.md', 'AGENTS.md']) {
      const path = join(dir, nom)
      if (existsSync(path))
        files.push(
          instruction(
            path,
            'codex',
            'shadowed',
            scopeFor(dir, query),
            raisonCodexProjet(path, cleReplieParAutowin)
          )
        )
    }
  }
  const known = new Set(files.map((file) => file.path))
  for (const path of discovered) {
    if (known.has(path)) continue
    files.push(
      instruction(
        path,
        'codex',
        'shadowed',
        scopeFor(dirname(path), query),
        raisonCodexProjet(path, cleReplieParAutowin)
      )
    )
  }
  return files
}

function claudeFiles(query: Required<BehaviourQuery>, discovered: string[]): BehaviourFile[] {
  const files: BehaviourFile[] = []
  // Autowin lance le CLI Claude NU : `--setting-sources ""` (`providers/claude.ts`). La mémoire
  // utilisateur globale n'est donc JAMAIS chargée sous Autowin — elle gouverne les sessions Claude
  // Code lancées à la main, pas les agents d'ici. L'annoncer `active` faisait douter l'utilisateur de
  // ce qui pilote réellement ses agents : un inventaire de gouvernance qui affiche « actif » sur un
  // fichier désarmé est pire qu'une ligne absente.
  const global = join(query.homeRoot, '.claude', 'CLAUDE.md')
  if (existsSync(global))
    files.push(
      instruction(
        global,
        'claude',
        'shadowed',
        'global',
        'Neutralisé par Autowin : CLI lancé avec --setting-sources ""'
      )
    )
  for (const dir of ancestors(query)) {
    // Ce qui est RÉELLEMENT replié dans le prompt vient de `PROJECT_CONTEXT_CHAIN`
    // (`context-files.ts`) : `AGENTS.md` → `CLAUDE.md` → `.cursorrules`, LE PREMIER TROUVÉ. Donc un
    // `CLAUDE.md` voisin d'un `AGENTS.md` ne sert pas, et `CLAUDE.local.md` n'est pas dans la chaîne
    // du tout — deux cas qui s'affichaient « actifs » sans jamais atteindre un prompt.
    const agentsPresent = ['AGENTS.md', 'agents.md'].some((nom) => existsSync(join(dir, nom)))
    const claudeMd = join(dir, 'CLAUDE.md')
    if (existsSync(claudeMd))
      files.push(
        instruction(
          claudeMd,
          'claude',
          agentsPresent ? 'shadowed' : 'active',
          scopeFor(dir, query),
          agentsPresent
            ? 'Masqué par AGENTS.md, premier de la chaîne de contexte projet'
            : 'Contexte projet replié dans le prompt'
        )
      )
    const claudeLocal = join(dir, 'CLAUDE.local.md')
    if (existsSync(claudeLocal))
      files.push(
        instruction(
          claudeLocal,
          'claude',
          'shadowed',
          scopeFor(dir, query),
          'Hors chaîne de contexte projet : jamais lu par Autowin'
        )
      )
  }
  const known = new Set(files.map((file) => file.path))
  for (const path of discovered) {
    if (!known.has(path))
      files.push(
        instruction(
          path,
          'claude',
          'conditional',
          scopeFor(dirname(path), query),
          'Chargé si ce contexte imbriqué est utilisé'
        )
      )
  }
  return files
}

/** La chaîne telle qu'un humain la lit : une seule fois chaque nom, sans ses variantes de casse. */
const CHAINE_LISIBLE = PROJECT_CONTEXT_CHAIN.filter(
  (nom, rang, tous) => tous.findIndex((autre) => autre.toLowerCase() === nom.toLowerCase()) === rang
).join(' → ')

/**
 * Le fichier de contexte projet, tel que le CHARGEUR RÉEL le traite.
 *
 * conv-984 (2026-10-16) : cette entrée tenait sa propre liste (`AGENTS.md`, `CLAUDE.md`,
 * `.cursorrules`) et affichait le gagnant « declared · injection non tracée », alors que
 * `projectContextBlock` le replie dans le prompt de chaque tour du chat (`index.ts`) et de chaque étape
 * lancée (`orchestrator.ts`). Le gagnant est maintenant demandé à `loadProjectContext` lui-même : même
 * chaîne, mêmes sauts (fichier vide ou illisible), donc la vue ne peut plus diverger du prompt.
 */
function autowinFiles(
  query: Required<BehaviourQuery>,
  gagnant: string | undefined
): BehaviourFile[] {
  const files: BehaviourFile[] = []
  const rangGagnant = gagnant
    ? PROJECT_CONTEXT_CHAIN.indexOf(gagnant)
    : PROJECT_CONTEXT_CHAIN.length
  const vus = new Set<string>()
  PROJECT_CONTEXT_CHAIN.forEach((name, rang) => {
    const path = join(query.contextRoot, name)
    try {
      if (!existsSync(path) || !statSync(path).isFile()) return
    } catch {
      return
    }
    // Windows : `AGENTS.md` et `agents.md` sont le MÊME fichier ; sans clé d'identité il ressortirait
    // une seconde fois « masqué par lui-même ».
    const cle = cleFichier(path)
    if (!cle || vus.has(cle)) return
    vus.add(cle)
    const scope = scopeFor(query.contextRoot, query)
    if (rang === rangGagnant) {
      const coupe = statSync(path).size > PROJECT_CONTEXT_MAX_BYTES
      files.push(
        instruction(
          path,
          'autowin',
          'injected',
          scope,
          `Replié dans le prompt de chaque tour du chat et de chaque étape lancée : premier fichier lisible de la chaîne ${CHAINE_LISIBLE}` +
            (coupe ? ` · coupé à ${PROJECT_CONTEXT_MAX_BYTES} octets` : '')
        )
      )
      return
    }
    files.push(
      instruction(
        path,
        'autowin',
        'shadowed',
        scope,
        rang < rangGagnant
          ? 'Vide ou illisible : sauté par la chaîne de contexte projet'
          : `Masqué par ${gagnant}, premier de la chaîne de contexte projet`
      )
    )
  })
  return files
}

export async function listBehaviourFiles(
  query?: string | BehaviourQuery
): Promise<BehaviourFile[]> {
  const normalized = normalizeQuery(query)
  const discovered = await discover(
    normalized.workspaceRoot,
    new Set(['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'CLAUDE.local.md'])
  )
  // Le fichier que le CHARGEUR RÉEL replie dans le prompt : demandé une seule fois, partagé par
  // l'entrée Autowin (qui l'affiche injecté) et l'entrée Codex (qui dit qu'Autowin le replie).
  const gagnantAutowin = loadProjectContext(normalized.contextRoot)?.file
  const groups = [
    codexFiles(
      normalized,
      discovered.filter((path) => /^AGENTS(?:\.override)?\.md$/i.test(basename(path))),
      gagnantAutowin
    ),
    claudeFiles(
      normalized,
      discovered.filter((path) => /^CLAUDE(?:\.local)?\.md$/i.test(basename(path)))
    ),
    autowinFiles(normalized, gagnantAutowin)
  ]
  return cappedBehaviourFiles(groups)
}

/** Lit un fichier depuis un inventaire déjà calculé, sans rescanner le workspace. */
export async function readBehaviourFileFromManifest(
  id: string,
  manifest: readonly BehaviourFile[],
  query?: string | BehaviourQuery
): Promise<string> {
  const normalized = normalizeQuery(query)
  const file = manifest.find((candidate) => candidate.id === id)
  if (!file) throw new Error('Fichier de comportement inconnu ou hors du workspace autorisé')
  const allowedRoots = [
    normalized.workspaceRoot,
    join(normalized.homeRoot, '.codex'),
    join(normalized.homeRoot, '.claude')
  ]
  if (!allowedRoots.some((root) => canonicalInside(file.path, root)))
    throw new Error('Fichier hors des racines autorisées')
  if (statSync(file.path).size > MAX_BYTES)
    throw new Error('Fichier de comportement trop volumineux (limite 512 Ko)')
  return readBoundedUtf8FileWithin(file.path, allowedRoots, MAX_BYTES)
}
