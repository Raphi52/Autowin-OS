import type { GitReadResult, GitDiffResult } from '../../shared/git-read'
import { execFile } from 'node:child_process'
import { resolve } from 'node:path'
import { promisify } from 'node:util'
import { readGitDiff, readGitState } from '../git-read-main'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from '../providers/workspace-mutation-evidence'
import {
  readCurrentConversationPathOwnership,
  workspaceTracePathKey
} from './conversation-file-trace-spool'

/**
 * Diff du DERNIER commit qui a touché `path` (lecture seule : `git log`). Sert au fichier de la
 * conversation déjà commité, que `git status` ne montre plus. Vide = fichier jamais commité.
 */
async function readLastCommitDiff(cwd: string, path: string): Promise<string> {
  try {
    const r = await promisify(execFile)(
      'git',
      ['log', '-1', '-p', '--no-color', '--format=', '--', path],
      { cwd, windowsHide: true }
    )
    return r.stdout
  } catch {
    return ''
  }
}

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
        const stillOwned = (key: string, committed = false): boolean => {
          const attribution = expected.get(key)
          return (
            Boolean(attribution?.fingerprint) &&
            Boolean(attribution?.generationMarker) &&
            // fix-ok: l'empreinte hache le diff contre HEAD, un commit la change par construction ;
            // pour un fichier commité (absent de git status), le marqueur physique seul fait foi.
            (committed || currentFingerprints.get(key) === attribution?.fingerprint) &&
            currentGenerationMarkers.get(key) === attribution?.generationMarker
          )
        }
        const pending = git.state.changes
          .filter((change) => stillOwned(workspaceTracePathKey(change.path)))
          .map((change) => ({ ...change, workspaceRoot }))
        // Cause du « Fichiers » vide : la liste ne venait QUE de git status, donc un fichier de la
        // conversation disparaissait dès son commit. Même contrôle d'attribution, source élargie.
        const inStatus = new Set(git.state.changes.map((change) => workspaceTracePathKey(change.path)))
        const committed = (
          await Promise.all(
            [...expected.entries()]
              .filter(([key]) => !inStatus.has(key) && stillOwned(key, true))
              .map(async ([, item]) =>
                (await readLastCommitDiff(workspaceRoot, item.path)).trim()
                  ? [{ path: item.path, status: 'committed' as const, staged: false, workspaceRoot }]
                  : []
              )
          )
        ).flat()
        return [...pending, ...committed]
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
    (currentPath !== undefined && currentFingerprint !== ownership.fingerprint) ||
    currentGenerationMarker !== ownership.generationMarker
  ) {
    return { available: false, error: 'Le diff courant appartient à une autre action.' }
  }
  if (!currentPath) {
    const diff = await readLastCommitDiff(ownership.workspaceRoot, ownership.path)
    return diff.trim()
      ? { available: true, diff }
      : { available: false, error: 'Aucun changement git pour ce fichier.' }
  }
  return readGitDiff(ownership.workspaceRoot, currentPath)
}
