import { existsSync, readdirSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { listCapabilities } from './capability-controls'
import { readBoundedUtf8FileWithin, readUtf8Prefix } from './bounded-file-read'
import { AUTOWIN_WORKSPACE_ENV, legacyWorkspaceEnvName } from '../shared/app-identity'

export type BehaviourEngine = 'codex' | 'claude' | 'hermes'
export type BehaviourState = 'active' | 'conditional' | 'shadowed' | 'declared' | 'injected'
export type BehaviourScope = 'global' | 'workspace' | 'project' | 'skill'

export interface BehaviourQuery {
  workspaceRoot?: string
  contextRoot?: string
  homeRoot?: string
  localAppDataRoot?: string
  includeHermesSkills?: boolean
}

export interface BehaviourContext {
  path: string
  label: string
  depth: number
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
  const amitelWorkspace = 'C:\\Code RIG'
  return existsSync(amitelWorkspace) ? amitelWorkspace : process.cwd()
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
  const includeHermesSkills = input.includeHermesSkills ?? input.homeRoot === undefined
  return { workspaceRoot, contextRoot, homeRoot, localAppDataRoot, includeHermesSkills }
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
      ? state === 'conditional'
        ? 'Si ce dossier devient le contexte Codex'
        : 'Au démarrage de la session Codex'
      : engine === 'claude'
        ? state === 'conditional'
          ? 'Lorsque Claude travaille dans ce sous-arbre'
          : 'Au chargement de la mémoire Claude'
        : scope === 'skill'
          ? 'À l’invocation de la skill'
          : 'Déclaré par Hermes · injection non tracée'
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
          : 'Configuration Hermes déclarée',
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

  // Hermes has no descendant flood: keep its declared sources and enabled skills visible first.
  for (const file of groups.find((group) => group[0]?.engine === 'hermes') ?? []) add(file)

  const remaining = groups.map((group) => group.filter((file) => !selectedIds.has(file.id)))
  while (selected.length < MAX_FILES && remaining.some((group) => group.length > 0)) {
    for (const group of remaining) {
      add(group.shift())
      if (selected.length >= MAX_FILES) break
    }
  }
  return selected
}

function discover(root: string, names: ReadonlySet<string>): string[] {
  if (!existsSync(root)) return []
  const normalizedNames = new Set([...names].map((name) => name.toLowerCase()))
  const files: string[] = []
  let visitedDirectories = 0
  const visit = (dir: string, depth: number): void => {
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
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (files.length >= MAX_FILES) break
      const path = join(dir, entry.name)
      if (entry.isDirectory()) visit(path, depth + 1)
      else if (
        entry.isFile() &&
        normalizedNames.has(entry.name.toLowerCase()) &&
        canonicalInside(path, root)
      )
        files.push(realpathSync(path))
    }
  }
  visit(root, 0)
  return files
}

function codexFiles(query: Required<BehaviourQuery>, discovered: string[]): BehaviourFile[] {
  const files: BehaviourFile[] = []
  const globalDir = join(query.homeRoot, '.codex')
  for (const dir of [globalDir, ...ancestors(query)]) {
    const override = join(dir, 'AGENTS.override.md')
    const base = join(dir, 'AGENTS.md')
    const global = dir === globalDir
    if (existsSync(override)) {
      files.push(
        instruction(
          override,
          'codex',
          'active',
          scopeFor(dir, query, global),
          'Priorité AGENTS.override.md'
        )
      )
      if (existsSync(base))
        files.push(
          instruction(
            base,
            'codex',
            'shadowed',
            scopeFor(dir, query, global),
            'Masqué par AGENTS.override.md'
          )
        )
    } else if (existsSync(base)) {
      files.push(
        instruction(
          base,
          'codex',
          'active',
          scopeFor(dir, query, global),
          'Applicable au contexte sélectionné'
        )
      )
    }
  }
  const known = new Set(files.map((file) => file.path))
  for (const path of discovered) {
    if (known.has(path)) continue
    const shadowedBySiblingOverride =
      basename(path).toLowerCase() === 'agents.md' &&
      discovered.some(
        (candidate) =>
          dirname(candidate) === dirname(path) &&
          basename(candidate).toLowerCase() === 'agents.override.md'
      )
    files.push(
      instruction(
        path,
        'codex',
        shadowedBySiblingOverride ? 'shadowed' : 'conditional',
        scopeFor(dirname(path), query),
        shadowedBySiblingOverride
          ? 'Masqué par AGENTS.override.md dans ce contexte'
          : 'Actif seulement dans ce contexte imbriqué'
      )
    )
  }
  return files
}

function claudeFiles(query: Required<BehaviourQuery>, discovered: string[]): BehaviourFile[] {
  const files: BehaviourFile[] = []
  const global = join(query.homeRoot, '.claude', 'CLAUDE.md')
  if (existsSync(global))
    files.push(instruction(global, 'claude', 'active', 'global', 'Mémoire utilisateur Claude'))
  for (const dir of ancestors(query)) {
    for (const name of ['CLAUDE.md', 'CLAUDE.local.md']) {
      const path = join(dir, name)
      if (existsSync(path))
        files.push(
          instruction(
            path,
            'claude',
            'active',
            scopeFor(dir, query),
            'Ancêtre du contexte sélectionné'
          )
        )
    }
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

function skillFiles(root: string, source: string): BehaviourFile[] {
  if (!existsSync(root)) return []
  return discover(root, new Set(['SKILL.md'])).flatMap((path) => {
    const fallbackName = basename(dirname(path))
    let header = ''
    try {
      header = readUtf8Prefix(path, 2048)
    } catch {
      return []
    }
    const skill = /^name:\s*["']?([^\r\n"']+)/m.exec(header)?.[1].trim() || fallbackName
    return [
      {
        ...instruction(path, 'hermes', 'conditional', 'skill', 'À l’invocation de la skill'),
        id: `hermes:skill:${source}:${relative(root, path).replaceAll('\\', '/')}`,
        label: skill,
        injectedInto: `Sous-agent utilisant ${skill}`
      }
    ]
  })
}

async function hermesFiles(query: Required<BehaviourQuery>): Promise<BehaviourFile[]> {
  const files: BehaviourFile[] = []
  const hermesRoot = join(query.localAppDataRoot, 'hermes')
  const soul = join(hermesRoot, 'SOUL.md')
  if (existsSync(soul))
    files.push(
      instruction(soul, 'hermes', 'declared', 'global', 'Déclaré par Hermes, injection non tracée')
    )

  const candidates = ['.hermes.md', 'AGENTS.md', 'CLAUDE.md', '.cursorrules']
  let selected = false
  for (const name of candidates) {
    const path = join(query.contextRoot, name)
    if (!existsSync(path)) continue
    const state: BehaviourState = selected ? 'shadowed' : 'declared'
    files.push(
      instruction(
        path,
        'hermes',
        state,
        scopeFor(query.contextRoot, query),
        selected
          ? 'Masqué par un candidat prioritaire'
          : 'Candidat prioritaire, injection non tracée'
      )
    )
    selected = true
  }

  if (!query.includeHermesSkills) return files

  const enabled = new Set(
    (await listCapabilities('skills')).filter((skill) => skill.enabled).map((skill) => skill.id)
  )
  const byName = new Map<string, BehaviourFile>()
  for (const skill of [
    ...skillFiles(join(hermesRoot, 'skills'), 'local'),
    ...skillFiles(join(hermesRoot, 'hermes-agent', 'skills'), 'builtin')
  ]) {
    if (enabled.has(skill.label) && !byName.has(skill.label)) byName.set(skill.label, skill)
  }
  files.push(...byName.values())
  return files
}

export async function listBehaviourContexts(
  query?: string | BehaviourQuery
): Promise<BehaviourContext[]> {
  const normalized = normalizeQuery(query)
  const paths = new Set<string>([normalized.workspaceRoot])
  for (const path of discover(
    normalized.workspaceRoot,
    new Set([
      'AGENTS.md',
      'AGENTS.override.md',
      'CLAUDE.md',
      'CLAUDE.local.md',
      '.hermes.md',
      '.cursorrules'
    ])
  )) {
    paths.add(dirname(path))
  }
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({
      path,
      label: relative(normalized.workspaceRoot, path) || basename(path),
      depth: relative(normalized.workspaceRoot, path).split(sep).filter(Boolean).length
    }))
}

export async function listBehaviourFiles(
  query?: string | BehaviourQuery
): Promise<BehaviourFile[]> {
  const normalized = normalizeQuery(query)
  const discovered = discover(
    normalized.workspaceRoot,
    new Set(['AGENTS.md', 'AGENTS.override.md', 'CLAUDE.md', 'CLAUDE.local.md'])
  )
  const groups = [
    codexFiles(
      normalized,
      discovered.filter((path) => /^AGENTS(?:\.override)?\.md$/i.test(basename(path)))
    ),
    claudeFiles(
      normalized,
      discovered.filter((path) => /^CLAUDE(?:\.local)?\.md$/i.test(basename(path)))
    ),
    await hermesFiles(normalized)
  ]
  return cappedBehaviourFiles(groups)
}

export async function readBehaviourFile(
  id: string,
  query?: string | BehaviourQuery
): Promise<string> {
  const normalized = normalizeQuery(query)
  const manifest = await listBehaviourFiles(normalized)
  const file = manifest.find((candidate) => candidate.id === id)
  if (!file) throw new Error('Fichier de comportement inconnu ou hors du workspace autorisé')
  const allowedRoots = [
    normalized.workspaceRoot,
    join(normalized.homeRoot, '.codex'),
    join(normalized.homeRoot, '.claude')
  ]
  allowedRoots.push(join(normalized.localAppDataRoot, 'hermes'))
  if (!allowedRoots.some((root) => canonicalInside(file.path, root)))
    throw new Error('Fichier hors des racines autorisées')
  if (statSync(file.path).size > MAX_BYTES)
    throw new Error('Fichier de comportement trop volumineux (limite 512 Ko)')
  return readBoundedUtf8FileWithin(file.path, allowedRoots, MAX_BYTES)
}
