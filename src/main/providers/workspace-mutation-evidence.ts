import { createHash, randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { lstat } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { readGitDiff, readGitState } from '../git-read-main'
import type { ExecutionEvidence } from './types'

export type WorkspaceMutationSnapshot = ReadonlyMap<string, string> & {
  generationMarkers: ReadonlyMap<string, string>
}

const watcherSessionId = randomUUID()
const watchedDirectories = new Map<string, FSWatcher>()
const pathWatchGenerations = new Map<string, number>()

function filesystemPathKey(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function ensurePathGenerationWatcher(absolutePath: string): void {
  const parent = dirname(absolutePath)
  const parentKey = filesystemPathKey(parent)
  if (watchedDirectories.has(parentKey)) return
  try {
    const watcher = watch(parent, { persistent: false }, (_event, filename) => {
      if (!filename) return
      const changedPath = filesystemPathKey(resolve(parent, filename.toString()))
      const generation = (pathWatchGenerations.get(changedPath) ?? 0) + 1
      pathWatchGenerations.set(changedPath, generation)
    })
    watcher.on('error', () => {
      watcher.close()
      watchedDirectories.delete(parentKey)
    })
    watchedDirectories.set(parentKey, watcher)
  } catch {
    // Le marqueur de contenu/stat reste disponible même si le watcher n'est pas supporté.
  }
}

async function settlePathGenerationEvents(): Promise<void> {
  await new Promise<void>((resolveSettle) => setTimeout(resolveSettle, 10))
}

/**
 * Marqueur de génération du fichier de travail, distinct du contenu Git. Une réécriture externe
 * à l'identique change mtime/ctime et invalide ainsi une ancienne attribution causale.
 */
export async function captureWorkspacePathGenerationMarker(
  cwd: string,
  path: string
): Promise<string> {
  const absolute = resolve(cwd, path)
  try {
    const entry = await lstat(absolute, { bigint: true })
    return `present:${entry.dev}:${entry.ino}:${entry.size}:${entry.mtimeNs}:${entry.ctimeNs}`
  } catch {
    ensurePathGenerationWatcher(absolute)
    await settlePathGenerationEvents()
    try {
      const restored = await lstat(absolute, { bigint: true })
      return `present:${restored.dev}:${restored.ino}:${restored.size}:${restored.mtimeNs}:${restored.ctimeNs}`
    } catch {
      // Le compteur durable est propre à ce chemin absent.
    }
    return `missing:${watcherSessionId}:${pathWatchGenerations.get(filesystemPathKey(absolute)) ?? 0}`
  }
}

function workspaceMutationSnapshot(
  entries: readonly (readonly [string, string, string])[]
): WorkspaceMutationSnapshot {
  return Object.assign(
    new Map(entries.map(([path, fingerprint]) => [path, fingerprint] as const)),
    {
      generationMarkers: new Map(
        entries.map(([path, , generationMarker]) => [path, generationMarker] as const)
      )
    }
  )
}

export async function captureWorkspaceMutationSnapshot(
  cwd: string
): Promise<WorkspaceMutationSnapshot> {
  const git = await readGitState(cwd, 0)
  if (!git.available || !git.state) return workspaceMutationSnapshot([])
  const entries = await Promise.all(
    git.state.changes.map(async (change) => {
      const diff = await readGitDiff(cwd, change.path)
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify({
            diff: diff.available ? (diff.diff ?? '') : `unavailable:${diff.error ?? ''}`
          }),
          'utf8'
        )
        .digest('hex')
      const path = change.path.replaceAll('\\', '/')
      return [
        path,
        fingerprint,
        await captureWorkspacePathGenerationMarker(cwd, path)
      ] as const
    })
  )
  return workspaceMutationSnapshot(entries)
}

export async function appendWorkspaceMutationEvidence(
  before: WorkspaceMutationSnapshot,
  cwd: string,
  evidence: ExecutionEvidence[]
): Promise<void> {
  try {
    const after = await captureWorkspaceMutationSnapshot(cwd)
    const paths = [...after.entries()]
      .filter(([path, fingerprint]) => before.get(path) !== fingerprint)
      .map(([path]) => path)
      .sort()
    if (paths.length === 0) return
    const pathGenerationMarkers = Object.fromEntries(
      paths.map((path) => [path, after.generationMarkers.get(path) as string])
    )
    evidence.push({
      type: 'workspace_delta',
      kind: 'mutation',
      status: 'completed',
      ok: true,
      summary: `${paths.length} fichier(s) modifié(s) dans le worktree isolé`,
      paths,
      workspaceRoot: cwd,
      pathFingerprints: Object.fromEntries(paths.map((path) => [path, after.get(path) as string])),
      pathBaseFingerprints: Object.fromEntries(
        paths.map((path) => [path, before.get(path) ?? null])
      ),
      pathBaseGenerationMarkers: Object.fromEntries(
        paths.map((path) => [path, before.generationMarkers.get(path) ?? null])
      ),
      pathGenerationMarkers
    })
  } catch {
    // Une preuve best-effort ne doit jamais transformer un tour réussi en échec.
  }
}
