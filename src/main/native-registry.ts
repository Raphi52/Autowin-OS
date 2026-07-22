import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ensureAutowinAppData } from './app-data'

/**
 * REGISTRE NATIF (Chantier 1 du découplage Hermes — le VERROU).
 *
 * Remplace le shell-out `hermes.exe {skills|tools|plugins|hooks} list|enable|disable` par une source
 * LOCALE à Autowin, sans sous-processus externe :
 *  - inventaire skills = scan disque des racines de skills (SKILL.md), déjà présent sur le poste ;
 *  - inventaire tools/plugins/hooks = un CATALOGUE local déclaratif (`catalog.v1.json`), amorçable une
 *    fois depuis Hermes puis figé (ces vues sont de l'AFFICHAGE — jamais injectées aux modèles) ;
 *  - état enabled/disabled = un fichier de préférences local (`enablement.v1.json`).
 *
 * `hermes-controls.ts` bascule sur ce registre quand il est actif (flag + présence du fichier), en
 * gardant le chemin Hermes en parallèle tant que la bascule n'est pas validée (rétro-compat douce).
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
 * Racines de skills scannées (Chantier 2 — souverain de Hermes) : le kit `~/.claude/skills` (l'âme
 * d'Autowin), `~/.codex/skills`, et la racine Autowin `%APPDATA%/autowin-os/skills`. Les dossiers
 * `hermes/skills` et `hermes-agent/skills` sont RETIRÉS : Autowin ne dépend plus de l'arbre Hermes.
 */
export function skillRoots(home = homedir(), localAppData = process.env.LOCALAPPDATA): string[] {
  const roots = [join(home, '.codex', 'skills'), join(home, '.claude', 'skills')]
  if (localAppData) roots.push(join(localAppData, 'autowin-os', 'skills'))
  return roots
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

function catalogControls(kind: 'tools' | 'plugins' | 'hooks', base = ensureAutowinAppData()): RegistryItem[] {
  const catalog = readJson<Catalog>(catalogPath(base), {})
  const decls = catalog[kind] ?? []
  const enablement = readJson<Enablement>(enablementPath(base), {})[kind] ?? {}
  return decls.map((d) => ({ ...d, enabled: enablement[d.id] !== false }))
}

/** Inventaire natif d'un type — remplace `listHermesControls(kind)` sans sous-processus. */
export function listNativeRegistry(kind: RegistryKind, base = ensureAutowinAppData()): RegistryItem[] {
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

/** Amorçage unique : fige l'état Hermes courant en local, puis Hermes n'est plus jamais appelé. */
export function seedRegistryFromHermes(
  snapshot: Partial<Record<RegistryKind, RegistryItem[]>>,
  base = ensureAutowinAppData()
): void {
  if (existsSync(enablementPath(base))) return // déjà amorcé → ne pas écraser l'état local
  const enablement: Enablement = {}
  const catalog: Catalog = {}
  for (const kind of ['skills', 'tools', 'plugins', 'hooks'] as RegistryKind[]) {
    const items = snapshot[kind]
    if (!items) continue
    enablement[kind] = Object.fromEntries(items.map((i) => [i.id, i.enabled]))
    if (kind !== 'skills') {
      catalog[kind] = items.map(({ enabled: _enabled, ...rest }) => rest)
    }
  }
  writeFileSync(catalogPath(base), JSON.stringify(catalog, null, 2), 'utf8')
  writeFileSync(enablementPath(base), JSON.stringify(enablement, null, 2), 'utf8')
}
