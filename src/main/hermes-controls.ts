import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'
import {
  nativeRegistryActive,
  listNativeRegistry,
  setNativeEnablement,
  seedRegistryFromHermes
} from './native-registry'

const execFileAsync = promisify(execFile)
const CACHE_TTL_MS = 60_000

/**
 * F5 — binaire Hermes RÉSOLU, plus hardcodé Windows-only :
 * 1) `HERMES_BIN` (chemin complet) ; 2) `HERMES_HOME` (racine de l'install) ; 3) défaut historique.
 * Un chemin absolu introuvable → erreur EXPLICITE (avant : échec muet → Tools/Skills/Hooks vides).
 */
export function hermesBin(env: NodeJS.ProcessEnv = process.env): string {
  if (env.HERMES_BIN) return env.HERMES_BIN
  const scriptName = process.platform === 'win32' ? 'hermes.exe' : 'hermes'
  if (env.HERMES_HOME)
    return join(env.HERMES_HOME, 'hermes-agent', 'venv', 'Scripts', scriptName)
  return process.platform === 'win32'
    ? join(homedir(), 'AppData', 'Local', 'hermes', 'hermes-agent', 'venv', 'Scripts', 'hermes.exe')
    : 'hermes'
}

export interface HermesControlItem {
  id: string
  label: string
  description: string
  enabled: boolean
  mutable: boolean
  source?: string
}

export type HermesControlKind = 'skills' | 'hooks' | 'tools' | 'plugins'
const controlCache = new Map<HermesControlKind, { expiresAt: number; items: HermesControlItem[] }>()
const controlRequests = new Map<HermesControlKind, Promise<HermesControlItem[]>>()

async function runHermes(args: string[]): Promise<string> {
  const bin = hermesBin()
  // F5 — chemin absolu introuvable → message actionnable, plutôt qu'un ENOENT opaque.
  if (isAbsolute(bin) && !existsSync(bin))
    throw new Error(
      `Hermes introuvable à « ${bin} ». Définir HERMES_BIN (chemin complet) ou HERMES_HOME (racine de l'install).`
    )
  const { stdout } = await execFileAsync(bin, args, {
    windowsHide: true,
    timeout: 15_000,
    maxBuffer: 512_000,
    env: { ...process.env, COLUMNS: '240', NO_COLOR: '1' }
  })
  return stdout
}

/**
 * F2 — garde anti-échec-silencieux : si la sortie Hermes contient des entrées (marqueurs
 * `enabled`/`disabled`) mais que le parseur n'a rien extrait, c'est un changement de format
 * (update Hermes) → on LÈVE une erreur explicite au lieu de rendre une liste vide trompeuse.
 */
export function guardParsed(
  items: HermesControlItem[],
  output: string,
  kind: string
): HermesControlItem[] {
  if (items.length === 0 && /\b(enabled|disabled)\b/i.test(output))
    throw new Error(
      `Format de sortie Hermes « ${kind} » non reconnu (probable changement de version) : ` +
        `sortie non vide, 0 entrée parsée.`
    )
  return items
}

export function parseTools(output: string): HermesControlItem[] {
  return output
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[✓✗]\s+(enabled|disabled)\s+([\w-]+)\s+(.+)$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => ({
      id: match[2],
      label: match[2],
      description: match[3].trim(),
      enabled: match[1] === 'enabled',
      mutable: true
    }))
}

export function parseSkills(output: string): HermesControlItem[] {
  return output
    .split(/\r?\n/)
    .filter((line) => /^│/.test(line) && !/Name\s+│|─/.test(line))
    .map((line) =>
      line
        .split('│')
        .slice(1, -1)
        .map((cell) => cell.trim())
    )
    .filter((cells) => cells.length >= 5 && ['enabled', 'disabled'].includes(cells[4]))
    .map((cells) => ({
      id: cells[0],
      label: cells[0],
      description: cells[1] || 'Sans catégorie',
      source: cells[2],
      enabled: cells[4] === 'enabled',
      mutable: false
    }))
}

export function parsePlugins(output: string): HermesControlItem[] {
  const value: unknown = JSON.parse(output)
  if (!Array.isArray(value)) throw new Error('Catalogue plugins Hermes invalide')
  const rows = value.filter(
    (
      item
    ): item is {
      name: string
      status: string
      version: string
      description: string
      source: string
    } =>
      typeof item === 'object' &&
      item !== null &&
      typeof item.name === 'string' &&
      typeof item.status === 'string' &&
      typeof item.version === 'string' &&
      typeof item.description === 'string' &&
      typeof item.source === 'string'
  )
  const occurrences = new Map<string, number>()
  for (const row of rows) occurrences.set(row.name, (occurrences.get(row.name) ?? 0) + 1)
  return rows.map((row) => ({
    id: row.name,
    label: row.name,
    description: row.description,
    enabled: row.status === 'enabled',
    mutable: occurrences.get(row.name) === 1,
    source: `${row.source} · v${row.version}`
  }))
}

async function loadHermesControls(kind: HermesControlKind): Promise<HermesControlItem[]> {
  // Chantier 1 — registre natif actif : source LOCALE, aucun shell-out vers hermes.exe.
  if (nativeRegistryActive()) return listNativeRegistry(kind)
  if (kind === 'tools') {
    const out = await runHermes(['tools', 'list', '--platform', 'cli'])
    return guardParsed(parseTools(out), out, 'tools')
  }
  if (kind === 'skills') {
    const out = await runHermes(['skills', 'list'])
    return guardParsed(parseSkills(out), out, 'skills')
  }
  if (kind === 'plugins') return parsePlugins(await runHermes(['plugins', 'list', '--json']))
  const output = await runHermes(['hooks', 'list'])
  if (/No shell hooks configured/i.test(output)) return []
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      id: `hook-${index + 1}`,
      label: line,
      description: 'Hook shell Hermes',
      enabled: true,
      mutable: false
    }))
}

export async function listHermesControls(kind: HermesControlKind): Promise<HermesControlItem[]> {
  const cached = controlCache.get(kind)
  if (cached && cached.expiresAt > Date.now()) return cached.items

  const running = controlRequests.get(kind)
  if (running) return running

  const request = loadHermesControls(kind).then((items) => {
    controlCache.set(kind, { expiresAt: Date.now() + CACHE_TTL_MS, items })
    return items
  })
  controlRequests.set(kind, request)
  try {
    return await request
  } finally {
    controlRequests.delete(kind)
  }
}

export async function warmHermesControls(): Promise<void> {
  try {
    // AMORÇAGE UNIQUE (fin du chantier 1) : si le registre natif n'est pas encore activé, on fige
    // l'état courant une seule fois — depuis Hermes s'il est présent, sinon vide — dans
    // enablement.v1.json + catalog.v1.json. Dès lors `nativeRegistryActive()` est vrai et TOUTES
    // les lectures/mutations passent en LOCAL : plus aucun appel à hermes.exe.
    if (!nativeRegistryActive()) {
      const snapshot: Partial<Record<HermesControlKind, HermesControlItem[]>> = {}
      for (const kind of ['skills', 'tools', 'plugins', 'hooks'] as HermesControlKind[]) {
        try {
          snapshot[kind] = await loadHermesControls(kind) // natif inactif → lecture Hermes brute
        } catch {
          /* hermes.exe absent/échoue → cette catégorie reste vide, l'amorçage continue */
        }
      }
      seedRegistryFromHermes(snapshot)
      controlCache.clear() // purge le cache Hermes → prochaines lectures = registre natif
    }
    await listHermesControls('skills')
  } catch {
    // Opportuniste : l'appel IPC affichera l'erreur réelle si nécessaire.
  }
}

export async function setHermesTool(
  name: string,
  enabled: boolean
): Promise<{
  items: HermesControlItem[]
  restartRequired: true
}> {
  if (!/^[a-z][a-z0-9_-]{0,63}$/.test(name)) throw new Error('Nom de toolset invalide')
  const known = await listHermesControls('tools')
  if (!known.some((item) => item.id === name)) throw new Error(`Toolset Hermes inconnu: ${name}`)
  if (nativeRegistryActive()) {
    setNativeEnablement('tools', name, enabled)
    controlCache.delete('tools')
    return { items: await listHermesControls('tools'), restartRequired: true }
  }
  await runHermes(['tools', enabled ? 'enable' : 'disable', name, '--platform', 'cli'])
  controlCache.delete('tools')
  return { items: await listHermesControls('tools'), restartRequired: true }
}

export function planToolSelection(
  catalogue: readonly string[],
  currentEnabled: readonly string[],
  targetEnabled: readonly string[]
): { enable: string[]; disable: string[] } {
  const known = new Set(catalogue)
  for (const name of targetEnabled) {
    if (!known.has(name)) throw new Error(`Toolset Hermes inconnu: ${name}`)
  }
  const current = new Set(currentEnabled)
  const target = new Set(targetEnabled)
  return {
    enable: catalogue.filter((name) => target.has(name) && !current.has(name)),
    disable: catalogue.filter((name) => current.has(name) && !target.has(name))
  }
}

type HermesRunner = (args: string[]) => Promise<string>

export async function applyToolSelectionPlan(
  plan: { enable: string[]; disable: string[] },
  runner: HermesRunner
): Promise<void> {
  let firstBatchApplied = false
  try {
    if (plan.disable.length > 0) {
      await runner(['tools', 'disable', ...plan.disable, '--platform', 'cli'])
      firstBatchApplied = true
    }
    if (plan.enable.length > 0) {
      await runner(['tools', 'enable', ...plan.enable, '--platform', 'cli'])
    }
  } catch (reason) {
    if (firstBatchApplied) {
      await runner(['tools', 'disable', ...plan.enable, '--platform', 'cli'])
      await runner(['tools', 'enable', ...plan.disable, '--platform', 'cli'])
    }
    throw reason
  }
}

export async function setHermesToolSelection(
  targetEnabled: readonly string[]
): Promise<{ items: HermesControlItem[]; restartRequired: true }> {
  const known = await listHermesControls('tools')
  const plan = planToolSelection(
    known.map((item) => item.id),
    known.filter((item) => item.enabled).map((item) => item.id),
    targetEnabled
  )
  await applyToolSelectionPlan(plan, runHermes)
  controlCache.delete('tools')
  return { items: await listHermesControls('tools'), restartRequired: true }
}

export async function setHermesPlugin(
  name: string,
  enabled: boolean
): Promise<{ items: HermesControlItem[]; restartRequired: true }> {
  if (!/^[a-z][a-z0-9_-]{0,127}$/.test(name)) throw new Error('Nom de plugin invalide')
  const known = await listHermesControls('plugins')
  const matches = known.filter((item) => item.id === name)
  if (matches.length === 0) throw new Error(`Plugin Hermes inconnu: ${name}`)
  if (matches.length > 1) throw new Error(`Plugin Hermes ambigu: ${name}`)
  if (nativeRegistryActive()) {
    setNativeEnablement('plugins', name, enabled)
    controlCache.delete('plugins')
    return { items: await listHermesControls('plugins'), restartRequired: true }
  }
  await runHermes([
    'plugins',
    enabled ? 'enable' : 'disable',
    name,
    ...(enabled ? ['--no-allow-tool-override'] : [])
  ])
  controlCache.delete('plugins')
  return { items: await listHermesControls('plugins'), restartRequired: true }
}
