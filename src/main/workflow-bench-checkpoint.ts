import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, lstatSync, mkdtempSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { CounterfactualCheckpointState } from './workflow-counterfactual'
import type { PersistedCheckpoint } from './wire-checkpoint-fork'

const run = promisify(execFile)
const GIT_CAPTURE_OPTIONS = {
  windowsHide: true,
  timeout: 10_000,
  encoding: 'utf8' as const,
  maxBuffer: 64 * 1024 * 1024
}

function safeWorkspacePath(root: string, path: string): string {
  const absolute = resolve(root, path)
  const rel = relative(root, absolute)
  if (rel === '..' || rel.startsWith(`..\\`) || rel.startsWith('../') || resolve(rel) === rel) {
    throw new Error(`Chemin hors checkpoint: ${path}`)
  }
  return absolute
}

async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolveRead, rejectRead) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', rejectRead)
    stream.on('end', resolveRead)
  })
  return hash.digest('hex')
}

/**
 * Matérialise l'état sale dans un commit Git détaché avec un index temporaire. L'index, HEAD et les
 * fichiers de l'utilisateur ne bougent pas ; les deux worktrees peuvent pourtant partir du contenu
 * EXACT capturé, y compris les fichiers non suivis.
 */
async function materializeWorkspaceCommit(root: string, headSha: string): Promise<string> {
  const scratch = mkdtempSync(join(tmpdir(), 'autowin-counterfactual-index-'))
  const env = {
    ...process.env,
    GIT_INDEX_FILE: join(scratch, 'index'),
    GIT_AUTHOR_NAME: 'Autowin OS',
    GIT_AUTHOR_EMAIL: 'autowin@local.invalid',
    GIT_COMMITTER_NAME: 'Autowin OS',
    GIT_COMMITTER_EMAIL: 'autowin@local.invalid'
  }
  try {
    await run('git', ['read-tree', headSha], { cwd: root, ...GIT_CAPTURE_OPTIONS, env })
    await run('git', ['add', '-A', '--', '.'], { cwd: root, ...GIT_CAPTURE_OPTIONS, env })
    const tree = await run('git', ['write-tree'], { cwd: root, ...GIT_CAPTURE_OPTIONS, env })
    const snapshot = await run(
      'git',
      ['commit-tree', tree.stdout.trim(), '-p', headSha, '-m', 'Autowin counterfactual checkpoint'],
      { cwd: root, ...GIT_CAPTURE_OPTIONS, env }
    )
    const sha = snapshot.stdout.trim()
    if (!/^[0-9a-f]{40,64}$/i.test(sha)) throw new Error('Commit de checkpoint invalide.')
    return sha
  } finally {
    rmSync(scratch, { recursive: true, force: true })
  }
}

/** Capture read-only de l'ancetre commun, avant que le premier bras ne soit lance. */
export async function captureWorkflowBenchCheckpoint(
  workspace: string,
  objective: string
): Promise<PersistedCheckpoint<CounterfactualCheckpointState>> {
  const root = resolve(workspace)
  const [head, status, trackedDiff, untracked] = await Promise.all([
    run('git', ['rev-parse', 'HEAD'], { cwd: root, ...GIT_CAPTURE_OPTIONS }),
    run('git', ['status', '--porcelain=v2', '-z'], { cwd: root, ...GIT_CAPTURE_OPTIONS }),
    run('git', ['diff', '--binary', '--no-ext-diff', 'HEAD', '--'], {
      cwd: root,
      ...GIT_CAPTURE_OPTIONS
    }),
    run('git', ['ls-files', '--others', '--exclude-standard', '-z'], {
      cwd: root,
      ...GIT_CAPTURE_OPTIONS
    })
  ])
  const baseSha = head.stdout.trim()
  if (!/^[0-9a-f]{40,64}$/i.test(baseSha)) {
    throw new Error('Le SHA source du contrefactuel est invalide.')
  }
  const dirty = status.stdout.length > 0
  const snapshotSha = dirty ? await materializeWorkspaceCommit(root, baseSha) : baseSha
  const content = createHash('sha256')
    .update(root, 'utf8')
    .update('\0')
    .update(baseSha, 'utf8')
    .update('\0')
    .update(trackedDiff.stdout, 'utf8')
  for (const path of untracked.stdout.split('\0').filter(Boolean).sort()) {
    const absolute = safeWorkspacePath(root, path)
    const stat = lstatSync(absolute)
    content.update('\0').update(path, 'utf8').update('\0')
    if (stat.isSymbolicLink()) content.update(readlinkSync(absolute), 'utf8')
    else if (stat.isFile()) content.update(await hashFile(absolute), 'utf8')
  }
  const createdAt = new Date().toISOString()
  const id = `counterfactual:${randomUUID()}`
  return {
    id,
    runId: id,
    createdAt,
    sourceSnapshot: {
      workspaceId: root,
      baseSha: snapshotSha,
      contentHash: content.digest('hex')
    },
    state: { objective, dirty }
  }
}

/** Empreintes de CONTENU du bureau retenu, jamais seulement sa liste de noms. */
export async function captureRetainedWorkspaceState(
  workspace: { path: string; files: readonly string[] }
): Promise<Record<string, string | null>> {
  const root = resolve(workspace.path)
  const state: Record<string, string | null> = {}
  for (const path of [...new Set(workspace.files)].sort().slice(0, 2_000)) {
    const absolute = safeWorkspacePath(root, path)
    try {
      const stat = lstatSync(absolute)
      state[path] = stat.isFile()
        ? await hashFile(absolute)
        : stat.isSymbolicLink()
          ? createHash('sha256').update(readlinkSync(absolute), 'utf8').digest('hex')
          : null
    } catch {
      state[path] = null
    }
  }
  return state
}
