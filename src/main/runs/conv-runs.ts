import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { readFile, readdir, rm, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { parseRun } from '../dashboards/runs'
import { scanRuns, type RunEntry } from '../dashboards/runs-scan'
import type { OrchestrationStep } from '../orchestrator'
import { ensureAutowinAppData } from '../app-data'

/**
 * RUN.md PAR CONVERSATION — chaque tâche/orchestration lancée depuis une conversation
 * laisse son workflow dans `%APPDATA%\autowin-os\runs\<convId>\<slug>-workspace\RUN.md`,
 * au FORMAT autowin (status/DoD/Journal) : le parseur existant (parseRun/scanRuns) les
 * lit tels quels. Volontairement HORS de ~/.claude/runs (aucun conflit avec les hooks du kit).
 */

export function convRunsRoot(): string {
  return join(ensureAutowinAppData(), 'runs')
}

function slugify(task: string): string {
  const s = task
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'tache'
}

/** Crée le RUN.md (status: open) d'une tâche lancée depuis une conversation. */
export function createConvRun(
  convId: string,
  task: string,
  root = convRunsRoot(),
  now: () => number = () => Date.now()
): string {
  // suffixe horodaté → pas de collision si la même tâche est relancée
  const dir = join(root, convId, `${slugify(task)}-${now().toString(36)}-workspace`)
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'RUN.md')
  const date = new Date(now()).toISOString().slice(0, 10)
  writeFileSync(
    path,
    `status: open
session: ${convId}
regime: standard
signal: verdict du juge + gate déterministe (orchestration in-app)

## Besoin
${task}

**Critere de succes (DoD cochable)** :
  - [ ] le juge valide le résultat et le gate autorise la clôture

## Contraintes
<!-- bornes de la solution (HARD/SOFT), source + conséquence si violée -->

## Options
<!-- si un choix d'approche est engagé : >=3 options scorées + ligne Décision -->

## SOP
<!-- terrain : procédure opératoire spécifique à la tâche — action -> commande/outil -> signal attendu -> fallback/arrêt -->

## Journal
[${date}] Orchestration lancée depuis la conversation ${convId}.

## Défauts

## Reprise
Goal:
Hypothesis:
Tried:
Next:
Blockers:

## Cicatrices

## Checks
`,
    'utf8'
  )
  return path
}

/** Réutilise un workflow ouvert de la même conversation/tâche, sinon en crée un. */
export async function reuseOrCreateConvRun(
  convId: string,
  task: string,
  root = convRunsRoot(),
  now: () => number = () => Date.now()
): Promise<{ path: string; reused: boolean }> {
  try {
    // Les RUN d'une conversation vivent sous leur propre dossier : borner le scan ici évite
    // de relire tout l'historique Autowin avant chaque envoi.
    const conversationRoot = join(root, convId)
    for (const workspace of await readdir(conversationRoot)) {
      const path = join(conversationRoot, workspace, 'RUN.md')
      try {
        const md = await readFile(path, 'utf8')
        if (parseRun(md).status === 'open' && md.includes(`## Besoin\n${task}`)) {
          return { path, reused: true }
        }
      } catch {
        // Un RUN isolé illisible ne masque pas les autres workflows de la conversation.
      }
    }
  } catch {
    // La recherche de workflow est une optimisation : une source illisible ne bloque pas le run.
  }
  return { path: createConvRun(convId, task, root, now), reused: false }
}

/** Extrait le contenu d'une section `## Nom` d'un markdown (jusqu'à la prochaine `## ` ou la fin). */
function extractSection(md: string, name: string): string {
  const re = new RegExp(`(?:^|\\n)##\\s+${name}\\s*\\n([\\s\\S]*?)(?=\\n##\\s|$)`, 'i')
  const m = md.match(re)
  return m ? m[1].trim() : ''
}

/**
 * J2 — peuple le RUN.md de la conversation avec le VRAI livrable des phases : le sous-agent
 * produit son travail structuré (Contraintes/Options/SOP…) dans sa réponse, mais le RUN.md que
 * Workflows affiche restait un template vide. On remplit les placeholders `<!-- -->` avec le
 * meilleur contenu (le plus complet) trouvé sur l'ensemble des phases, et on annexe l'agrégat.
 */
export function populateConvRunSections(
  runPath: string,
  phaseOutputs: { phase: string; text: string }[]
): void {
  if (!phaseOutputs?.length) return
  try {
    let md = readFileSync(runPath, 'utf8')
    for (const section of ['Contraintes', 'Options', 'SOP']) {
      // le contenu le plus long parmi les phases = le plus complet (résiste à une phase qui dérive)
      const best = phaseOutputs
        .map((p) => extractSection(p.text, section))
        .filter((c) => c && !c.startsWith('<!--'))
        .sort((a, b) => b.length - a.length)[0]
      if (!best) continue
      const placeholder = new RegExp(`(##\\s+${section}\\n)<!--[\\s\\S]*?-->`, 'i')
      if (placeholder.test(md)) md = md.replace(placeholder, `$1${best}`)
    }
    const annexe = phaseOutputs
      .map((p) => `### phase ${p.phase}\n${p.text.slice(0, 2000)}`)
      .join('\n\n')
    const section = `## Livrable des phases\n${annexe}\n`
    if (md.includes('## Livrable des phases')) {
      // A3 — peuplement LIVE : la section est réécrite à chaque phase (idempotent), pas dupliquée.
      md = md.replace(/## Livrable des phases\n[\s\S]*?(?=\n## Reprise)/, section)
    } else {
      md = md.replace(/\n## Reprise/, `\n${section}\n## Reprise`)
    }
    writeFileSync(runPath, md, 'utf8')
  } catch {
    /* peuplement best-effort : un RUN.md template reste lisible, pas fatal */
  }
}

/** Clôt le RUN selon le verdict du gate (green = validé, red = rejeté/crash). */
export function closeConvRun(path: string, green: boolean, journalLine: string): void {
  try {
    let md = readFileSync(path, 'utf8')
    md = md.replace(/^status: open/m, `status: ${green ? 'green' : 'red'}`)
    if (green) md = md.replace(/^ {2}- \[ \] (le juge valide.*)$/m, '  - [x] $1')
    md = md.replace(/^## Journal$/m, `## Journal`)
    md = md.replace(
      /(## Journal\n)/,
      `$1[${new Date().toISOString().slice(0, 10)}] ${journalLine}\n`
    )
    writeFileSync(path, md, 'utf8')
  } catch {
    /* clôture best-effort : un RUN resté open est visible, pas fatal */
  }
}

/**
 * Vrai si le fichier COMMENCE par ce texte, en ne lisant que les premiers octets.
 *
 * La réconciliation examine des milliers de RUN.md dont l'immense majorité est déjà close : les
 * charger entiers pour ne regarder que leur première ligne coûterait des dizaines de mégaoctets à
 * chaque démarrage.
 */
function commencePar(path: string, prefixe: string): boolean {
  const tampon = Buffer.alloc(Buffer.byteLength(prefixe, 'utf8'))
  let fd: number | undefined
  try {
    fd = openSync(path, 'r')
    const lus = readSync(fd, tampon, 0, tampon.length, 0)
    return lus === tampon.length && tampon.toString('utf8') === prefixe
  } finally {
    if (fd !== undefined) closeSync(fd)
  }
}

/**
 * Clôt les runs restés `open` alors que plus personne ne les porte.
 *
 * `closeConvRun` n'est appelé qu'à la FIN d'une orchestration : si l'app s'arrête avant — crash,
 * fermeture, coupure — le `RUN.md` garde `status: open` et rien ne l'en sort jamais. Mesuré le
 * 2026-08-05 sur l'état réel (8888 workspaces) : 151 runs `open` dont **141 vieux de plus de 24 h**.
 * Le taux de réussite se lisant dans ces fichiers, ces 141 le faussaient en silence — ni succès, ni
 * échec, alors que ce sont des échecs. `red` est le statut juste : la docstring de `closeConvRun` le
 * dit déjà, « red = rejeté/crash ».
 *
 * Le SEUIL protège les runs en vol et ceux que la reprise va récupérer : ceux-là ont un `mtime` de
 * quelques secondes, jamais de plusieurs heures. Le PLAFOND borne le travail au démarrage, et le
 * reste est RENVOYÉ pour être journalisé — une troncature muette se lirait « tout est traité ».
 *
 * Ne lit que le début de chaque fichier : le statut est en première ligne, inutile de charger 8888
 * documents entiers. Coût mesuré de la seule traversée : ~360 ms pour 8888 workspaces.
 */
export function reconcileAbandonedConvRuns(options: {
  root?: string
  now?: number
  olderThanMs?: number
  max?: number
}): { closed: number; remaining: number } {
  const root = options.root ?? convRunsRoot()
  const now = options.now ?? Date.now()
  const olderThanMs = options.olderThanMs ?? 24 * 3_600_000
  const max = options.max ?? 500
  let closed = 0
  let remaining = 0
  let convs: string[]
  try {
    convs = readdirSync(root)
  } catch {
    return { closed: 0, remaining: 0 } // racine absente : rien à réconcilier, et surtout rien à casser
  }
  for (const conv of convs) {
    let workspaces: string[]
    try {
      workspaces = readdirSync(join(root, conv))
    } catch {
      continue
    }
    for (const ws of workspaces) {
      // Seuls les workspaces portent un RUN.md à clore ; un worktree d'agent n'en est pas un.
      if (!ws.endsWith('-workspace')) continue
      const path = join(root, conv, ws, 'RUN.md')
      try {
        if (now - statSync(path).mtimeMs <= olderThanMs) continue
        if (!commencePar(path, 'status: open')) continue
      } catch {
        continue // RUN.md absent ou illisible : ce n'est pas à la réconciliation de le signaler
      }
      if (closed >= max) {
        remaining += 1
        continue
      }
      closeConvRun(
        path,
        false,
        "Abandonné : l'app s'est arrêtée avant la clôture, aucun verdict n'a été rendu."
      )
      closed += 1
    }
  }
  return { closed, remaining }
}

/** Chemin du sidecar de trace (fil des sous-agents) d'un RUN.md. */
function tracePath(runPath: string): string {
  return join(dirname(runPath), 'trace.json')
}

const STEP_TEXT_CAP = 4000

/**
 * Persiste le FIL des sous-agents (exec/juge/gate avec contenu) à côté du RUN.md.
 * Sidecar JSON séparé → ne casse pas le format autowin du .md. Contenu cappé.
 */
export function saveConvRunTrace(runPath: string, steps: OrchestrationStep[]): void {
  try {
    const trimmed = steps.map((s) => ({
      ...s,
      text: s.text && s.text.length > STEP_TEXT_CAP ? `${s.text.slice(0, STEP_TEXT_CAP)}…` : s.text
    }))
    writeFileSync(tracePath(runPath), JSON.stringify(trimmed), 'utf8')
  } catch {
    /* la trace est un bonus d'affichage : son échec ne casse rien */
  }
}

/** Relit le fil des sous-agents d'un run (null si absent/illisible). */
export function loadConvRunTrace(runPath: string): OrchestrationStep[] | null {
  try {
    const p = tracePath(runPath)
    if (!existsSync(p)) return null
    const data = JSON.parse(readFileSync(p, 'utf8'))
    return Array.isArray(data) ? (data as OrchestrationStep[]) : null
  } catch {
    return null
  }
}

/** Runs d'UNE conversation : ceux créés dans son dossier + les RUN.md attachés. */
export function listConvRuns(
  convId: string,
  attachedPaths: string[] = [],
  root = convRunsRoot()
): Promise<RunEntry[]> {
  return scanRuns(join(root)).then(async (runs) => {
    const own = runs.filter((r) => r.session === convId)
    const attached = (
      await Promise.all(
        attachedPaths.map(async (p): Promise<RunEntry | null> => {
          try {
            const [md, runStat] = await Promise.all([readFile(p, 'utf8'), stat(p)])
            const subject = dirname(p)
              .split(/[\\/]/)
              .pop()!
              .replace(/-workspace$/, '')
            return {
              subject,
              session: 'attaché',
              path: p,
              mtime: runStat.mtimeMs,
              summary: parseRun(md, subject)
            }
          } catch {
            return null
          }
        })
      )
    ).filter((entry): entry is RunEntry => entry !== null)
    return [...own, ...attached].sort((a, b) => b.mtime - a.mtime)
  })
}

function comparablePath(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLocaleLowerCase('en-US') : absolute
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right)
}

/**
 * Retire un RUN de la conversation sans accepter de chemin arbitraire venant du renderer.
 * Les runs natifs appartiennent à Autowin : leur workspace complet (trace comprise) est supprimé.
 * Un RUN externe reste la propriété de son outil d'origine : il est uniquement détaché.
 */
export async function deleteConvRun(
  convId: string,
  runPath: string,
  attachedPaths: string[] = [],
  root = convRunsRoot()
): Promise<{ kind: 'deleted' } | { kind: 'detached'; attachedPath: string }> {
  const candidate = resolve(runPath)
  const attachedPath = attachedPaths.find((path) => samePath(path, candidate))
  if (attachedPath) {
    return { kind: 'detached', attachedPath }
  }

  const conversationRoot = resolve(root, convId)
  const workspace = dirname(candidate)
  const workspaceRelative = relative(conversationRoot, workspace)
  const isDirectNativeWorkspace =
    workspaceRelative !== '' &&
    workspaceRelative !== '..' &&
    !workspaceRelative.startsWith(`..${sep}`) &&
    !isAbsolute(workspaceRelative) &&
    !workspaceRelative.includes(sep) &&
    basename(candidate).toLocaleLowerCase('en-US') === 'run.md'

  if (isDirectNativeWorkspace) {
    const allowed = (await listConvRuns(convId, attachedPaths, root)).some(
      (run) => run.session === convId && samePath(run.path, candidate)
    )
    if (!allowed) throw new Error('RUN non autorisé pour cette conversation')
    await rm(workspace, { recursive: true, force: false })
    return { kind: 'deleted' }
  }

  throw new Error('RUN non autorisé pour cette conversation')
}
