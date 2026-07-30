import {
  accessSync,
  constants,
  existsSync,
  readFileSync,
  realpathSync,
  statSync
} from 'node:fs'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { spawn } from 'node:child_process'
import { killEscalate } from './providers/watchdog'

const DEFAULT_TIMEOUT_MS = 10 * 60_000
const MAX_CAPTURE_CHARS = 64 * 1024
const MAX_GRAPH_BYTES = 128 * 1024 * 1024
const DEFAULT_SHARED_GRAPHIFY_SOURCE =
  process.platform === 'win32' ? '\\\\ged2\\rig\\Projets IA\\Graphify' : undefined
export const GRAPHIFY_WHEEL_NAME = 'graphifyy-0.9.11-py3-none-any.whl'
export const GRAPHIFY_WHEEL_SHA256 =
  '750b77232f460275aba596b09a1b8f289a1238a41ef5ad0edc29464e523b28ca'
export const GRAPHIFY_REQUIREMENTS_SHA256 =
  'f1240f8372936d5ee15dd2cdf6bace762c998d57845ec64373723d6517084436'

export interface GraphifyProcessOptions {
  cwd: string
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export interface GraphifyProcessResult {
  stdout: string
  stderr: string
}

export type GraphifyProcessRunner = (
  executable: string,
  args: string[],
  options: GraphifyProcessOptions
) => Promise<GraphifyProcessResult>

export interface GraphifyCommandInput {
  workspaceRoot: string
  path?: string
}

export interface GraphifyCommandResult {
  action: 'created' | 'updated'
  target: string
  graph: string
  nodes: number
  links: number
  builtAtCommit?: string
  durationMs: number
}

export interface GraphifyLaunch {
  executable: string
  prefixArgs: string[]
  source: 'configured' | 'verified-shared' | 'local'
}

function appendBounded(current: string, chunk: Buffer | string): string {
  const next = current + chunk.toString()
  return next.length <= MAX_CAPTURE_CHARS ? next : next.slice(-MAX_CAPTURE_CHARS)
}

export async function executeGraphifyProcess(
  executable: string,
  args: string[],
  options: GraphifyProcessOptions
): Promise<GraphifyProcessResult> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (
      outcome:
        | { ok: true; value: GraphifyProcessResult }
        | { ok: false; error: Error }
    ): void => {
      if (settled) return
      settled = true
      clearTimeout(deadline)
      if (outcome.ok) resolvePromise(outcome.value)
      else reject(outcome.error)
    }
    const deadline = setTimeout(() => {
      killEscalate(child)
      finish({
        ok: false,
        error: new Error(`Graphify a dépassé son délai de ${timeoutMs} ms`)
      })
    }, timeoutMs)
    deadline.unref?.()

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout = appendBounded(stdout, chunk)
    })
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr = appendBounded(stderr, chunk)
    })
    child.on('error', (error) => finish({ ok: false, error }))
    child.on('close', (code) => {
      if (code === 0) {
        finish({ ok: true, value: { stdout, stderr } })
        return
      }
      const detail = stderr.trim() || stdout.trim() || `exit ${code ?? 'signal'}`
      finish({
        ok: false,
        error: new Error(`Graphify a échoué (${code ?? 'signal'}) : ${detail.slice(-800)}`)
      })
    })
  })
}

function isWithin(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  return rel === '' || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))
}

function resolveTarget(workspaceRoot: string, requestedPath: string | undefined): {
  workspace: string
  target: string
} {
  const workspace = realpathSync(resolve(workspaceRoot))
  const requested = requestedPath?.trim() || '.'
  if (requested.includes('\0')) throw new Error('chemin Graphify invalide')
  const unresolved = isAbsolute(requested) ? resolve(requested) : resolve(workspace, requested)
  if (!isWithin(workspace, unresolved)) throw new Error('codebase Graphify hors du workspace')
  let target: string
  try {
    target = realpathSync(unresolved)
  } catch {
    throw new Error(`codebase Graphify introuvable : ${requested}`)
  }
  if (!isWithin(workspace, target)) throw new Error('codebase Graphify hors du workspace')
  if (!statSync(target).isDirectory()) throw new Error(`la cible Graphify n'est pas un dossier : ${requested}`)

  const outputDir = join(target, 'graphify-out')
  if (existsSync(outputDir)) {
    const realOutput = realpathSync(outputDir)
    if (!isWithin(target, realOutput)) {
      throw new Error('dossier graphify-out hors de la codebase')
    }
  }
  return { workspace, target }
}

function portableRelative(root: string, path: string): string {
  const value = relative(root, path)
  return (value || '.').split(sep).join('/')
}

function checkedExecutable(path: string, source: string): string {
  if (!isAbsolute(path)) {
    throw new Error(`${source} doit contenir un chemin absolu vers Graphify`)
  }
  let executable: string
  try {
    executable = realpathSync(path)
    const metadata = statSync(executable)
    if (!metadata.isFile()) throw new Error('not a file')
    accessSync(executable, process.platform === 'win32' ? constants.F_OK : constants.X_OK)
  } catch {
    throw new Error(`CLI Graphify introuvable : ${path}`)
  }
  return executable
}

export function resolveGraphifyExecutable(
  configuredExecutable = process.env.AUTOWIN_GRAPHIFY_BIN?.trim(),
  pathValue = process.env.PATH ?? ''
): string {
  if (configuredExecutable) {
    return checkedExecutable(configuredExecutable, 'AUTOWIN_GRAPHIFY_BIN')
  }
  const names = process.platform === 'win32' ? ['graphify.exe'] : ['graphify']
  for (const rawDirectory of pathValue.split(delimiter)) {
    const directory = rawDirectory.trim().replace(/^"(.*)"$/, '$1')
    if (!directory || !isAbsolute(directory)) continue
    for (const name of names) {
      const candidate = join(directory, name)
      if (!existsSync(candidate)) continue
      try {
        return checkedExecutable(candidate, 'PATH')
      } catch {
        // Continue vers la prochaine entrée PATH utilisable.
      }
    }
  }
  throw new Error(
    'CLI Graphify introuvable. Installe Graphify ou configure AUTOWIN_GRAPHIFY_BIN avec un chemin absolu.'
  )
}

export function resolveGraphifyLaunch(
  configuredExecutable = process.env.AUTOWIN_GRAPHIFY_BIN?.trim(),
  pathValue = process.env.PATH ?? '',
  sharedSource = process.env.AUTOWIN_GRAPHIFY_SOURCE?.trim() ||
    DEFAULT_SHARED_GRAPHIFY_SOURCE,
  installRoot = join(
    process.env.LOCALAPPDATA?.trim() || homedir(),
    'Amitel',
    'Autowin OS',
    'graphify'
  )
): GraphifyLaunch {
  if (configuredExecutable) {
    return {
      executable: checkedExecutable(configuredExecutable, 'AUTOWIN_GRAPHIFY_BIN'),
      prefixArgs: [],
      source: 'configured'
    }
  }
  if (sharedSource) {
    if (!isAbsolute(sharedSource)) {
      throw new Error('AUTOWIN_GRAPHIFY_SOURCE doit contenir un chemin absolu')
    }
    const markerPath = join(installRoot, 'installation.json')
    const executable = join(
      installRoot,
      '.venv',
      process.platform === 'win32' ? 'Scripts' : 'bin',
      process.platform === 'win32' ? 'graphify.exe' : 'graphify'
    )
    try {
      const marker = JSON.parse(readFileSync(markerPath, 'utf8').replace(/^\uFEFF/, '')) as {
        version?: unknown
        wheelSha256?: unknown
        requirementsSha256?: unknown
      }
      if (
        marker.version === '0.9.11' &&
        marker.wheelSha256 === GRAPHIFY_WHEEL_SHA256 &&
        marker.requirementsSha256 === GRAPHIFY_REQUIREMENTS_SHA256
      ) {
        return {
          executable: checkedExecutable(executable, 'installation Graphify vérifiée'),
          prefixArgs: [],
          source: 'verified-shared'
        }
      }
    } catch {
      // Le bootstrap ci-dessous fournit un diagnostic unique et actionnable.
    }
    throw new Error(
      'Graphify partagé non préparé. Exécute scripts/bootstrap-deps.ps1 sur ce poste.'
    )
  }
  return {
    executable: resolveGraphifyExecutable(undefined, pathValue),
    prefixArgs: [],
    source: 'local'
  }
}

function assertGraphPathWithinTarget(target: string, graphPath: string): void {
  const outputDir = join(target, 'graphify-out')
  if (existsSync(outputDir) && !isWithin(target, realpathSync(outputDir))) {
    throw new Error('dossier graphify-out hors de la codebase')
  }
  if (existsSync(graphPath) && !isWithin(target, realpathSync(graphPath))) {
    throw new Error('graphe Graphify hors de la codebase')
  }
}

async function readGraphSummary(graphPath: string): Promise<{
  nodes: number
  links: number
  builtAtCommit?: string
}> {
  let metadata
  try {
    metadata = statSync(graphPath)
  } catch {
    throw new Error(`Graphify n'a produit aucun graphe : ${graphPath}`)
  }
  if (metadata.size > MAX_GRAPH_BYTES) {
    throw new Error(`graphe Graphify trop volumineux (${metadata.size} octets)`)
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(await readFile(graphPath, 'utf8'))
  } catch {
    throw new Error(`graphe Graphify invalide : ${graphPath}`)
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`graphe Graphify invalide : ${graphPath}`)
  }
  const graph = parsed as { nodes?: unknown; links?: unknown; built_at_commit?: unknown }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.links)) {
    throw new Error(`graphe Graphify invalide : ${graphPath}`)
  }
  return {
    nodes: graph.nodes.length,
    links: graph.links.length,
    ...(typeof graph.built_at_commit === 'string'
      ? { builtAtCommit: graph.built_at_commit }
      : {})
  }
}

export async function runGraphify(
  input: GraphifyCommandInput,
  dependencies: {
    run?: GraphifyProcessRunner
    executable?: string
    timeoutMs?: number
  } = {}
): Promise<GraphifyCommandResult> {
  const { workspace, target } = resolveTarget(input.workspaceRoot, input.path)
  const graphPath = join(target, 'graphify-out', 'graph.json')
  assertGraphPathWithinTarget(target, graphPath)
  const action = existsSync(graphPath) ? 'updated' : 'created'
  const args =
    action === 'updated'
      ? ['update', target, '--no-cluster']
      : ['extract', target, '--code-only', '--no-cluster']
  const run = dependencies.run ?? executeGraphifyProcess
  const launch: GraphifyLaunch =
    dependencies.executable !== undefined
      ? {
          executable: checkedExecutable(dependencies.executable, 'executable Graphify'),
          prefixArgs: [],
          source: 'configured'
        }
      : run === executeGraphifyProcess
        ? resolveGraphifyLaunch()
        : { executable: 'graphify', prefixArgs: [], source: 'local' }
  const startedAt = performance.now()
  try {
    await run(launch.executable, [...launch.prefixArgs, ...args], {
      cwd: target,
      env: { ...process.env, GRAPHIFY_OUT: 'graphify-out' },
      timeoutMs: dependencies.timeoutMs
    })
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'ENOENT'
    ) {
      throw new Error(
        'CLI Graphify introuvable. Installe Graphify ou configure AUTOWIN_GRAPHIFY_BIN.'
      )
    }
    throw error
  }
  assertGraphPathWithinTarget(target, graphPath)
  const summary = await readGraphSummary(graphPath)
  return {
    action,
    target: portableRelative(workspace, target),
    graph: portableRelative(workspace, graphPath),
    ...summary,
    durationMs: Math.round(performance.now() - startedAt)
  }
}
