import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
} from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import type { ExecutionEvidence } from '../providers/types'
import type { GitReadResult } from '../../shared/git-read'

const SPOOL_MAX_BYTES = 4 * 1024 * 1024

export interface ConversationFileTrace {
  timestamp: string
  conversationId: string
  turnId?: string
  workspaceRoot: string
  source: 'edit_file' | 'subagent'
  paths: string[]
  /** Empreinte du diff courant immédiatement après la mutation. */
  pathFingerprints?: Record<string, string>
  pathBaseFingerprints?: Record<string, string | null>
  pathGenerationMarkers?: Record<string, string>
  pathBaseGenerationMarkers?: Record<string, string | null>
}

function spoolRoot(base = ensureAutowinAppData()): string {
  const root = join(base, 'conversation-file-trace-spool')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

function normalizedStoredPath(path: string): string {
  return path
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
}

export function workspaceTracePathKey(path: string): string {
  const normalized = normalizedStoredPath(path)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function canonicalWorkspaceRoot(workspaceRoot: string): string {
  const normalized = resolve(workspaceRoot).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export function normalizeWorkspaceTracePath(path: string, workspaceRoot: string): string | null {
  const trimmed = path.trim()
  if (!trimmed) return null
  const root = resolve(workspaceRoot)
  const absolute = isAbsolute(trimmed) ? resolve(trimmed) : resolve(root, trimmed)
  const rel = relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return null
  const normalized = normalizedStoredPath(rel)
  return normalized.startsWith('.git/') || normalized === '.git' ? null : normalized
}

export function appendConversationFileTrace(
  trace: ConversationFileTrace,
  base = ensureAutowinAppData()
): void {
  const paths = [...new Set(trace.paths.map(normalizedStoredPath).filter(Boolean))]
  if (!trace.conversationId.trim() || !trace.workspaceRoot.trim() || paths.length === 0) return
  try {
    const root = spoolRoot(base)
    const path = join(root, 'events.jsonl')
    if (existsSync(path) && statSync(path).size > SPOOL_MAX_BYTES) {
      const previous = join(root, 'events.previous.jsonl')
      if (existsSync(previous)) {
        appendFileSync(join(root, 'events.archive.jsonl'), readFileSync(previous))
        rmSync(previous, { force: true })
      }
      renameSync(path, previous)
    }
    const normalizedFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprint = Object.entries(trace.pathFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return fingerprint ? [[path, fingerprint]] : []
      })
    )
    const normalizedBaseFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(trace.pathBaseFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    const normalizedGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const marker = Object.entries(trace.pathGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return marker ? [[path, marker]] : []
      })
    )
    const normalizedBaseGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(trace.pathBaseGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    appendFileSync(
      path,
      `${JSON.stringify({
        ...trace,
        workspaceRoot: canonicalWorkspaceRoot(trace.workspaceRoot),
        paths,
        ...(Object.keys(normalizedFingerprints).length > 0
          ? { pathFingerprints: normalizedFingerprints }
          : {}),
        ...(Object.keys(normalizedBaseFingerprints).length > 0
          ? { pathBaseFingerprints: normalizedBaseFingerprints }
          : {}),
        ...(Object.keys(normalizedGenerationMarkers).length > 0
          ? { pathGenerationMarkers: normalizedGenerationMarkers }
          : {}),
        ...(Object.keys(normalizedBaseGenerationMarkers).length > 0
          ? { pathBaseGenerationMarkers: normalizedBaseGenerationMarkers }
          : {})
      })}\n`,
      'utf8'
    )
  } catch {
    // L'observabilité ne doit jamais interrompre la mutation qu'elle décrit.
  }
}

export function appendExecutionEvidenceFileTrace(
  evidence: readonly ExecutionEvidence[] | undefined,
  context: { conversationId: string; turnId?: string; workspaceRoot: string },
  base = ensureAutowinAppData()
): void {
  for (const item of evidence ?? []) {
    if (!item.ok || item.kind !== 'mutation') continue
    const workspaceRoot = item.workspaceRoot ?? context.workspaceRoot
    const paths = (item.paths ?? (item.path ? [item.path] : []))
      .map((path) => normalizeWorkspaceTracePath(path, workspaceRoot))
      .filter((path): path is string => Boolean(path))
    const pathFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const fingerprint = Object.entries(item.pathFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return fingerprint ? [[path, fingerprint]] : []
      })
    )
    const pathBaseFingerprints = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(item.pathBaseFingerprints ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    const pathGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const marker = Object.entries(item.pathGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )?.[1]
        return marker ? [[path, marker]] : []
      })
    )
    const pathBaseGenerationMarkers = Object.fromEntries(
      paths.flatMap((path) => {
        const match = Object.entries(item.pathBaseGenerationMarkers ?? {}).find(
          ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
        )
        return match ? [[path, match[1]]] : []
      })
    )
    appendConversationFileTrace(
      {
        timestamp: new Date().toISOString(),
        conversationId: context.conversationId,
        ...(context.turnId ? { turnId: context.turnId } : {}),
        workspaceRoot,
        source: 'subagent',
        paths,
        ...(Object.keys(pathFingerprints).length > 0 ? { pathFingerprints } : {}),
        ...(Object.keys(pathBaseFingerprints).length > 0
          ? { pathBaseFingerprints }
          : {}),
        ...(Object.keys(pathGenerationMarkers).length > 0
          ? { pathGenerationMarkers }
          : {}),
        ...(Object.keys(pathBaseGenerationMarkers).length > 0
          ? { pathBaseGenerationMarkers }
          : {})
      },
      base
    )
  }
}

function readFileTraces(path: string): ConversationFileTrace[] {
  if (!existsSync(path)) return []
  const traces: ConversationFileTrace[] = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as ConversationFileTrace
      if (
        typeof parsed.conversationId === 'string' &&
        Array.isArray(parsed.paths) &&
        parsed.paths.every((item) => typeof item === 'string')
      ) {
        traces.push(parsed)
      }
    } catch {
      // Une dernière ligne partielle après crash est ignorée.
    }
  }
  return traces
}

export function readConversationFilePaths(
  conversationId: string,
  base = ensureAutowinAppData(),
  workspaceRoot?: string
): string[] {
  const root = spoolRoot(base)
  const expectedWorkspace = workspaceRoot ? canonicalWorkspaceRoot(workspaceRoot) : undefined
  const paths = [
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ]
    .filter(
      (trace) =>
        trace.conversationId === conversationId &&
        (!expectedWorkspace ||
          (typeof trace.workspaceRoot === 'string' &&
            canonicalWorkspaceRoot(trace.workspaceRoot) === expectedWorkspace))
    )
    .flatMap((trace) => trace.paths)
    .map(normalizedStoredPath)
  return [...new Set(paths)]
}

export interface ConversationPathOwnership {
  conversationId: string
  workspaceRoot: string
  path: string
  fingerprint?: string
  generationMarker?: string
}

/**
 * Génération causale courante par workspace+chemin. Une chaîne before→after conserve tous ses
 * contributeurs ; une base absente ou différente ouvre une nouvelle génération et révoque l'ancienne.
 */
export function readCurrentConversationPathOwnership(
  conversationId: string,
  base = ensureAutowinAppData()
): ConversationPathOwnership[] {
  const root = spoolRoot(base)
  const generations = new Map<
    string,
    {
      fingerprint?: string
      generationMarker?: string
      owners: Map<string, ConversationPathOwnership>
    }
  >()
  const traces = [
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ]
  for (const trace of traces) {
    if (typeof trace.workspaceRoot !== 'string') continue
    const workspaceRoot = canonicalWorkspaceRoot(trace.workspaceRoot)
    for (const path of trace.paths) {
      const normalized = normalizedStoredPath(path)
      const fingerprint = Object.entries(trace.pathFingerprints ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )?.[1]
      const baseMatch = Object.entries(trace.pathBaseFingerprints ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )
      const baseGenerationMatch = Object.entries(
        trace.pathBaseGenerationMarkers ?? {}
      ).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )
      const generationMarker = Object.entries(trace.pathGenerationMarkers ?? {}).find(
        ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(normalized)
      )?.[1]
      const key = `${workspaceRoot}\0${workspaceTracePathKey(normalized)}`
      const generation: {
        fingerprint?: string
        generationMarker?: string
        owners: Map<string, ConversationPathOwnership>
      } = generations.get(key) ?? { owners: new Map() }
      if (
        !baseMatch ||
        !baseGenerationMatch ||
        baseMatch[1] !== generation.fingerprint ||
        baseGenerationMatch[1] !== generation.generationMarker
      ) {
        generation.owners.clear()
      }
      generation.fingerprint = fingerprint
      generation.generationMarker = generationMarker
      generation.owners.set(trace.conversationId, {
        conversationId: trace.conversationId,
        workspaceRoot,
        path: normalized,
        ...(fingerprint ? { fingerprint } : {}),
        ...(generationMarker ? { generationMarker } : {})
      })
      generations.set(key, generation)
    }
  }
  return [...generations.values()].flatMap((generation) =>
    [...generation.owners.values()]
      .filter((ownership) => ownership.conversationId === conversationId)
      .map((ownership) => ({
        ...ownership,
        ...(generation.fingerprint ? { fingerprint: generation.fingerprint } : {}),
        ...(generation.generationMarker
          ? { generationMarker: generation.generationMarker }
          : {})
      }))
  )
}

export function filterConversationGitState(
  git: GitReadResult,
  attributedPaths: readonly string[]
): GitReadResult {
  if (!git.state) return git
  const allowed = new Set(attributedPaths.map(workspaceTracePathKey))
  return {
    ...git,
    state: {
      ...git.state,
      changes: git.state.changes.filter((change) => allowed.has(workspaceTracePathKey(change.path)))
    }
  }
}
