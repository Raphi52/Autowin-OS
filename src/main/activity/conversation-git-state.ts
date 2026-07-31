import type { GitReadResult, GitDiffResult } from '../../shared/git-read'
import { resolve } from 'node:path'
import { readGitDiff, readGitState } from '../git-read-main'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from '../providers/workspace-mutation-evidence'
import {
  readCurrentConversationPathOwnership,
  workspaceTracePathKey
} from './conversation-file-trace-spool'

function workspaceRootKey(path: string): string {
  const normalized = resolve(path).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export async function readConversationGitState(
  conversationId: string,
  baseWorkspace: string,
  spoolBase?: string
): Promise<GitReadResult> {
  const baseGit = await readGitState(baseWorkspace)
  const ownership = readCurrentConversationPathOwnership(conversationId, spoolBase)
  const byWorkspace = new Map<string, typeof ownership>()
  for (const item of ownership) {
    const entries = byWorkspace.get(item.workspaceRoot) ?? []
    entries.push(item)
    byWorkspace.set(item.workspaceRoot, entries)
  }
  const changes = (
    await Promise.all(
      [...byWorkspace.entries()].map(async ([workspaceRoot, entries]) => {
        const [git, snapshot] = await Promise.all([
          readGitState(workspaceRoot, 0),
          captureWorkspaceMutationSnapshot(workspaceRoot)
        ])
        if (!git.available || !git.state) return []
        const currentFingerprints = new Map(
          [...snapshot].map(([path, fingerprint]) => [
            workspaceTracePathKey(path),
            fingerprint
          ])
        )
        const expected = new Map(
          entries.map((item) => [
            workspaceTracePathKey(item.path),
            { fingerprint: item.fingerprint, generationMarker: item.generationMarker, path: item.path }
          ])
        )
        const currentGenerationMarkers = new Map(
          await Promise.all(
            entries.map(async (item) => [
              workspaceTracePathKey(item.path),
              await captureWorkspacePathGenerationMarker(workspaceRoot, item.path)
            ] as const)
          )
        )
        return git.state.changes
          .filter((change) => {
            const key = workspaceTracePathKey(change.path)
            const attribution = expected.get(key)
            return (
              Boolean(attribution?.fingerprint) &&
              Boolean(attribution?.generationMarker) &&
              currentFingerprints.get(key) === attribution?.fingerprint &&
              currentGenerationMarkers.get(key) === attribution?.generationMarker
            )
          })
          .map((change) => ({ ...change, workspaceRoot }))
      })
    )
  ).flat()
  return {
    ...baseGit,
    available: baseGit.available || changes.length > 0,
    state: {
      branch: baseGit.state?.branch ?? '',
      ahead: baseGit.state?.ahead ?? 0,
      behind: baseGit.state?.behind ?? 0,
      changes
    }
  }
}

export async function readConversationGitDiff(
  conversationId: string,
  path: string,
  workspaceRoot: string,
  spoolBase?: string
): Promise<GitDiffResult> {
  const ownership = readCurrentConversationPathOwnership(conversationId, spoolBase).find(
    (item) =>
      workspaceRootKey(item.workspaceRoot) === workspaceRootKey(workspaceRoot) &&
      workspaceTracePathKey(item.path) === workspaceTracePathKey(path)
  )
  if (!ownership?.fingerprint || !ownership.generationMarker) {
    return { available: false, error: 'Fichier non attribué à cette conversation.' }
  }
  const [git, snapshot, currentGenerationMarker] = await Promise.all([
    readGitState(ownership.workspaceRoot, 0),
    captureWorkspaceMutationSnapshot(ownership.workspaceRoot),
    captureWorkspacePathGenerationMarker(ownership.workspaceRoot, ownership.path)
  ])
  const currentPath = git.state?.changes.find(
    (change) => workspaceTracePathKey(change.path) === workspaceTracePathKey(path)
  )?.path
  const currentFingerprint = [...snapshot].find(
    ([candidate]) => workspaceTracePathKey(candidate) === workspaceTracePathKey(path)
  )?.[1]
  if (
    !currentPath ||
    currentFingerprint !== ownership.fingerprint ||
    currentGenerationMarker !== ownership.generationMarker
  ) {
    return { available: false, error: 'Le diff courant appartient à une autre action.' }
  }
  return readGitDiff(ownership.workspaceRoot, currentPath)
}
