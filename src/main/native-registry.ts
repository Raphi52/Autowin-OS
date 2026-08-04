import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'

/**
 * REGISTRE NATIF — source LOCALE unique des capacités, sans aucun sous-processus externe :
 *  - inventaire skills = scan disque des racines de skills (SKILL.md), déjà présent sur le poste ;
 *  - inventaire tools/plugins/hooks = un CATALOGUE local déclaratif (`catalog.v1.json`), amorçable une
 *    fois via un snapshot puis figé (ces vues sont de l'AFFICHAGE — jamais injectées aux modèles) ;
 *  - état enabled/disabled = un fichier de préférences local (`enablement.v1.json`).
 *
 * `capability-controls.ts` lit exclusivement ce registre (générique tous providers).
 */

export interface RegistryItem {
  id: string
  label: string
  description: string
  enabled: boolean
  mutable: boolean
  source?: string
}
export type RegistryKind = 'skills' | 'hooks' | 'tools' | 'plugins'

interface Enablement {
  skills?: Record<string, boolean>
  tools?: Record<string, boolean>
  plugins?: Record<string, boolean>
  hooks?: Record<string, boolean>
}
interface Catalog {
  tools?: Omit<RegistryItem, 'enabled'>[]
  plugins?: Omit<RegistryItem, 'enabled'>[]
  hooks?: Omit<RegistryItem, 'enabled'>[]
}

function registryDir(base = ensureAutowinAppData()): string {
  const dir = join(base, 'registry')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return dir
}
export function enablementPath(base = ensureAutowinAppData()): string {
  return join(registryDir(base), 'enablement.v1.json')
}
export function catalogPath(base = ensureAutowinAppData()): string {
  return join(registryDir(base), 'catalog.v1.json')
}

function readJson<T>(path: string, fallback: T): T {
  try {
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as T) : fallback
  } catch {
    return fallback
  }
}

/** true si le registre natif doit être utilisé (flag explicite OU fichier d'état déjà présent). */
export function nativeRegistryActive(base = ensureAutowinAppData()): boolean {
  if (process.env.AUTOWIN_NATIVE_REGISTRY === '0') return false
  if (process.env.AUTOWIN_NATIVE_REGISTRY === '1') return true
  return existsSync(enablementPath(base))
}

/**
 * Racines de skills scannées : le kit `~/.claude/skills` (l'âme d'Autowin), `~/.codex/skills`, et la
 * racine Autowin `%APPDATA%/autowin-os/skills`. Générique : indépendant de tout arbre externe.
 */
/**
 * Emplacements possibles des skills EMBARQUÉES avec l'application, par ordre de préférence.
 *
 * Le chemin doit résoudre en dev ET en application packagée : `process.cwd()` vaut la racine du dépôt
 * en dev mais pas après empaquetage, où le code vit dans `app.asar`. On tente donc plusieurs candidats
 * et on garde le premier qui porte réellement des skills — vérifier plutôt que supposer un layout.
 * `__dirname` est absent quand ce module tourne en ESM (vitest) : on le sonde au lieu de le supposer.
 */
export function bundledSkillsCandidates(): string[] {
  const candidates: string[] = []
  if (process.env.AUTOWIN_SKILLS_ROOT) candidates.push(process.env.AUTOWIN_SKILLS_ROOT)
  candidates.push(join(process.cwd(), 'skills'))
  const here = typeof __dirname === 'string' ? __dirname : undefined
  // Packagé : le bundle vit dans `<app>/out/main` → la racine `skills/` est deux niveaux au-dessus.
  if (here) candidates.push(join(here, '..', '..', 'skills'), join(here, '..', 'skills'))
  const resources = (process as { resourcesPath?: string }).resourcesPath
  if (resources) candidates.push(join(resources, 'app.asar', 'skills'), join(resources, 'skills'))
  return candidates
}

/** Première racine embarquée qui porte VRAIMENT des skills (sinon undefined — jamais un chemin deviné). */
export function bundledSkillsRoot(
  candidates = bundledSkillsCandidates()
): string | undefined {
  return candidates.find(
    (candidate) =>
      existsSync(join(candidate, '_engine', 'ENGINE.md')) ||
      existsSync(join(candidate, 'build', 'SKILL.md'))
  )
}

/**
 * Racines de skills scannées. La racine EMBARQUÉE (dépôt) passe en tête : le comportement de l'app ne
 * doit pas dépendre d'un arbre externe qu'elle ne possède pas — sans kit local, les phases s'injectaient
 * VIDES sans que rien ne l'annonce. Les racines externes (`~/.codex`, `~/.claude`, `%LOCALAPPDATA%`)
 * restent lues ensuite : la découverte des skills du poste est une fonctionnalité, pas un accident.
 *
 * Échappatoire nommée `AUTOWIN_SKILLS_PREFER_LOCAL=1` : remet le kit local devant, pour travailler sur
 * le kit et voir l'effet sans rebuild. Reléguée, la racine embarquée n'est jamais perdue.
 */
export function skillRoots(
  home = homedir(),
  localAppData = process.env.LOCALAPPDATA,
  bundled = bundledSkillsRoot()
): string[] {
  const roots = [join(home, '.codex', 'skills'), join(home, '.claude', 'skills')]
  if (localAppData) roots.push(join(localAppData, 'autowin-os', 'skills'))
  if (!bundled) return roots
  return process.env.AUTOWIN_SKILLS_PREFER_LOCAL === '1' ? [...roots, bundled] : [bundled, ...roots]
}

/** Lit le champ `name:` d'un SKILL.md (front-matter simple) ; à défaut le nom du dossier. */
function skillIdFrom(dir: string, fallback: string): string {
  try {
    const md = readFileSync(join(dir, 'SKILL.md'), 'utf8')
    const m = md.match(/^name:\s*(.+)$/m)
    if (m) return m[1].trim()
  } catch {
    /* pas de front-matter → fallback */
  }
  return fallback
}

function scanSkillDirs(root: string): { id: string; dir: string }[] {
  const out: { id: string; dir: string }[] = []
  let entries: string[]
  try {
    entries = readdirSync(root)
  } catch {
    return out
  }
  for (const name of entries) {
    const dir = join(root, name)
    try {
      if (!statSync(dir).isDirectory()) continue
      if (!existsSync(join(dir, 'SKILL.md'))) continue
      out.push({ id: skillIdFrom(dir, name), dir })
    } catch {
      continue
    }
  }
  return out
}

export function nativeSkills(base = ensureAutowinAppData()): RegistryItem[] {
  const enablement = readJson<Enablement>(enablementPath(base), {}).skills ?? {}
  const seen = new Set<string>()
  const items: RegistryItem[] = []
  for (const root of skillRoots()) {
    for (const { id } of scanSkillDirs(root)) {
      if (seen.has(id)) continue // premier-gagne (dédup cross-racines)
      seen.add(id)
      items.push({
        id,
        label: id,
        description: 'Skill (SKILL.md)',
        enabled: enablement[id] !== false, // actif par défaut ; seul un false explicite désactive
        mutable: true,
        source: 'disque'
      })
    }
  }
  return items
}

function catalogControls(
  kind: 'tools' | 'plugins' | 'hooks',
  base = ensureAutowinAppData()
): RegistryItem[] {
  const catalog = readJson<Catalog>(catalogPath(base), {})
  const decls = catalog[kind] ?? []
  const enablement = readJson<Enablement>(enablementPath(base), {})[kind] ?? {}
  return decls.map((d) => ({ ...d, enabled: enablement[d.id] !== false }))
}

/** Inventaire natif d'un type de capacité (source locale, sans sous-processus). */
export function listNativeRegistry(
  kind: RegistryKind,
  base = ensureAutowinAppData()
): RegistryItem[] {
  if (kind === 'skills') return nativeSkills(base)
  return catalogControls(kind, base)
}

/** Active/désactive un élément dans l'état local (persisté). Pas de redémarrage forcé requis. */
export function setNativeEnablement(
  kind: RegistryKind,
  id: string,
  enabled: boolean,
  base = ensureAutowinAppData()
): RegistryItem[] {
  const path = enablementPath(base)
  const state = readJson<Enablement>(path, {})
  const kindState = { ...(state[kind] ?? {}) }
  kindState[id] = enabled
  const next: Enablement = { ...state, [kind]: kindState }
  writeFileSync(path, JSON.stringify(next, null, 2), 'utf8')
  return listNativeRegistry(kind, base)
}

/** Amorçage unique : fige un snapshot d'état en local (catalogue + activation). Idempotent. */
export function seedRegistrySnapshot(
  snapshot: Partial<Record<RegistryKind, RegistryItem[]>>,
  base = ensureAutowinAppData()
): void {
  const enablementFile = enablementPath(base)
  const catalogFile = catalogPath(base)
  const existingEnablement = readJson<Enablement>(enablementFile, {})
  const enablement: Enablement = { ...existingEnablement }
  const catalog: Catalog = {}
  for (const kind of ['skills', 'tools', 'plugins', 'hooks'] as RegistryKind[]) {
    const items = snapshot[kind]
    if (!items) continue
    enablement[kind] = {
      ...Object.fromEntries(items.map((i) => [i.id, i.enabled])),
      ...(existingEnablement[kind] ?? {})
    }
    if (kind !== 'skills') {
      catalog[kind] = items.map(({ id, label, description, mutable, source }) => ({
        id,
        label,
        description,
        mutable,
        source
      }))
    }
  }
  // Un toggle peut créer enablement.v1.json avant que le catalogue soit amorcé :
  // chaque fichier est donc initialisé indépendamment, sans écraser l'état déjà choisi.
  if (!existsSync(catalogFile)) writeFileSync(catalogFile, JSON.stringify(catalog, null, 2), 'utf8')
  writeFileSync(enablementFile, JSON.stringify(enablement, null, 2), 'utf8')
}
