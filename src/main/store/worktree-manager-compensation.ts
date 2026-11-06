// Hooks de publication et plans de compensation : méthodes de WorktreeManager déplacées telles quelles depuis worktree-manager.ts
// (conv-1508, lot 3). Chacune reçoit l'instance en `this` ; elles sont rattachées au prototype
// par attacherMethodes dans worktree-manager.ts, donc les appels `this.x(...)` restent identiques.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { isSameProcessIdentity } from '../app/process-identity'
import { supprimerArbre } from '../fichiers/fs-supprimer'
import type {
  CompensationIndexLock,
  CompensationIndexLockOwner,
  CompensationIndexRecoveryMarker,
  FinalizeResult,
  PublicationCompensationIntent,
  PublicationCompensationPlan
} from './worktree-manager-types'
import {
  SAFE_ID,
  GIT_COMMAND_TIMEOUT_MS,
  assertSafeId,
  shellPath,
  shellQuote,
  parseNullSeparatedPaths,
  COMPENSATION_INDEX_ACQUIRE_MAX_AGE_MS,
  COMPENSATION_INDEX_MARKER_SWEEP_LIMIT
} from './worktree-manager-outils'
import type { WorktreeManager } from './worktree-manager'

export function preparePublishHooks(
  this: WorktreeManager,
  agentId: string,
  integrationPath: string,
  baseSha: string,
  integratedSha: string,
  expectedBaseBranch: string,
  expectedPublicationRef: string,
  agentFiles: string[],
  expectedIndexTree: string
): string {
  const hooksPath = join(integrationPath, '.autowin-publish-hooks')
  const inputPath = join(hooksPath, 'reference-transaction.input')
  const markerPath = join(hooksPath, 'preflight-passed')
  const postHookChangePath = join(hooksPath, 'post-hook-change')
  const postHookRejectedPath = join(hooksPath, 'post-hook-rejected')
  const postHookIndexedAgentPathsPath = join(hooksPath, 'post-hook-indexed-agent-paths')
  const postHookWorktreeAgentPathsPath = join(hooksPath, 'post-hook-worktree-agent-paths')
  const postHookUntrackedAgentPathsPath = join(hooksPath, 'post-hook-untracked-agent-paths')
  const postHookIndexTreePath = join(hooksPath, 'post-hook-index-tree')
  const postHookWorktreeTreePath = join(hooksPath, 'post-hook-worktree-tree')
  const postHookSnapshotIndexPath = join(hooksPath, 'post-hook-snapshot-index')
  const initialAgentStatusPath = join(hooksPath, 'initial-agent-status')
  const compensationIntentPath = join(hooksPath, 'compensation-intent.json')
  const activeHooksDir = this.activeHooksDir()
  const originalReferenceHook = join(activeHooksDir, 'reference-transaction')
  const originalPostMergeHook = join(activeHooksDir, 'post-merge')
  const expectedRef = `refs/heads/${expectedBaseBranch}`
  const agentPathSpecs = agentFiles.map((file) => shellQuote(`:(literal)${file}`)).join(' ')
  const nonAgentPathSpecs = ['.', ...agentFiles.map((file) => `:(exclude,literal)${file}`)]
    .map(shellQuote)
    .join(' ')
  mkdirSync(hooksPath, { recursive: true })
  const compensationIntent: PublicationCompensationIntent = {
    version: 1,
    agentId,
    baseSha,
    publicationSha: integratedSha,
    expectedBaseBranch,
    agentFiles
  }
  writeFileSync(compensationIntentPath, JSON.stringify(compensationIntent))

  const chainReferenceHook = existsSync(originalReferenceHook)
    ? `${shellQuote(shellPath(originalReferenceHook))} "$@" < ${shellQuote(shellPath(inputPath))}\n` +
      'original_status=$?\n'
    : ''
  const referenceHook = `#!/bin/sh
state="$1"
cat > ${shellQuote(shellPath(inputPath))} || exit 90
original_status=0
validate_initial_workspace() {
  actual_ref=$(git symbolic-ref --quiet HEAD) || {
    echo "AUTOWIN_GUARD:detached-head" >&2
    exit 91
  }
  [ "$actual_ref" = ${shellQuote(expectedRef)} ] || {
    echo "AUTOWIN_GUARD:branch-changed" >&2
    exit 92
  }
  actual_head=$(git rev-parse HEAD) || exit 93
  [ "$actual_head" = ${shellQuote(baseSha)} ] || {
    echo "AUTOWIN_GUARD:head-changed" >&2
    exit 94
  }
  actual_index_tree=$(git write-tree) || exit 95
  [ "$actual_index_tree" = ${shellQuote(expectedIndexTree)} ] || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
  git status --porcelain=v1 -z --untracked-files=all -- ${agentPathSpecs} > ${shellQuote(shellPath(initialAgentStatusPath))} || exit 95
  [ ! -s ${shellQuote(shellPath(initialAgentStatusPath))} ] || {
    echo "AUTOWIN_GUARD:agent-worktree-changed" >&2
    exit 95
  }
  unmerged_files=$(git diff --name-only --diff-filter=U) || exit 96
  [ -z "$unmerged_files" ] || {
    echo "AUTOWIN_GUARD:unmerged-files" >&2
    exit 96
  }
  for operation_name in MERGE_HEAD CHERRY_PICK_HEAD REVERT_HEAD REBASE_HEAD BISECT_START rebase-merge rebase-apply sequencer; do
    operation_path=$(git rev-parse --git-path "$operation_name") || exit 96
    [ ! -e "$operation_path" ] || {
      echo "AUTOWIN_GUARD:operation-in-progress" >&2
      exit 96
    }
  done
}
validate_publish_workspace() {
  git diff --cached --quiet ${shellQuote(expectedIndexTree)} -- ${nonAgentPathSpecs} || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
  git diff --cached --quiet ${shellQuote(integratedSha)} -- ${agentPathSpecs} || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
  git diff --quiet -- ${agentPathSpecs} || {
    echo "AUTOWIN_GUARD:index-changed" >&2
    exit 95
  }
}
updates_expected_ref=0
updates_publication_ref=0
if [ "$state" = "prepared" ]; then
  while read -r old_sha new_sha ref_name; do
    case "$ref_name" in
      ${shellQuote(expectedPublicationRef)})
        updates_publication_ref=1
        ;;
      refs/heads/*)
        if [ "$ref_name" != ${shellQuote(expectedRef)} ] || [ "$old_sha" != ${shellQuote(baseSha)} ] || [ "$new_sha" != ${shellQuote(integratedSha)} ]; then
          echo "AUTOWIN_GUARD:unexpected-ref-update" >&2
          exit 96
        fi
        updates_expected_ref=1
        ;;
    esac
  done < ${shellQuote(shellPath(inputPath))}
fi
publication_transaction=0
if [ "$state" = "prepared" ] && [ "$updates_publication_ref" -eq 1 ]; then
  publication_transaction=1
  validate_initial_workspace
fi
initial_transaction=0
if [ "$state" = "prepared" ] && [ "$updates_expected_ref" -eq 0 ] && [ "$updates_publication_ref" -eq 0 ] && [ ! -f ${shellQuote(shellPath(markerPath))} ]; then
  initial_transaction=1
  validate_initial_workspace
fi
if [ "$state" = "prepared" ] && [ "$updates_expected_ref" -eq 1 ]; then
  [ -f ${shellQuote(shellPath(markerPath))} ] || {
    echo "AUTOWIN_GUARD:preflight-missing" >&2
    exit 95
  }
  validate_publish_workspace
  pre_chained_index_tree=$(git write-tree) || exit 95
fi
${chainReferenceHook}if [ "$initial_transaction" -eq 1 ]; then
  validate_initial_workspace
  [ "$original_status" -eq 0 ] || exit "$original_status"
  : > ${shellQuote(shellPath(markerPath))} || exit 97
fi
if [ "$publication_transaction" -eq 1 ]; then
  validate_initial_workspace
  [ "$original_status" -eq 0 ] || exit "$original_status"
fi
if [ "$state" = "prepared" ] && [ "$updates_expected_ref" -eq 1 ]; then
  post_chained_index_tree=$(git write-tree) || exit 95
  printf '%s\n' "$post_chained_index_tree" > ${shellQuote(shellPath(postHookIndexTreePath))} || exit 95
  git diff --name-only -z "$pre_chained_index_tree" "$post_chained_index_tree" -- ${agentPathSpecs} > ${shellQuote(shellPath(postHookIndexedAgentPathsPath))}
  git diff --name-only -z ${shellQuote(integratedSha)} -- ${agentPathSpecs} > ${shellQuote(shellPath(postHookWorktreeAgentPathsPath))}
  git ls-files --others -z -- ${agentPathSpecs} > ${shellQuote(shellPath(postHookUntrackedAgentPathsPath))}
  if [ "$original_status" -ne 0 ]; then
    : > ${shellQuote(shellPath(postHookRejectedPath))} || exit 97
  fi
  if [ "$original_status" -ne 0 ] || [ "$pre_chained_index_tree" != "$post_chained_index_tree" ] || [ -s ${shellQuote(shellPath(postHookWorktreeAgentPathsPath))} ] || [ -s ${shellQuote(shellPath(postHookUntrackedAgentPathsPath))} ]; then
    actual_index_path=$(git rev-parse --git-path index) || exit 95
    cp "$actual_index_path" ${shellQuote(shellPath(postHookSnapshotIndexPath))} || exit 95
    GIT_INDEX_FILE=${shellQuote(shellPath(postHookSnapshotIndexPath))} git add -A -f -- ${agentPathSpecs} || exit 95
    GIT_INDEX_FILE=${shellQuote(shellPath(postHookSnapshotIndexPath))} git write-tree > ${shellQuote(shellPath(postHookWorktreeTreePath))} || exit 95
    rm -f ${shellQuote(shellPath(postHookSnapshotIndexPath))}
    : > ${shellQuote(shellPath(postHookChangePath))} || exit 97
    echo "AUTOWIN_GUARD:index-changed-after-hook" >&2
    [ "$original_status" -eq 0 ] || exit "$original_status"
    exit 98
  fi
fi
exit 0
`
  const referenceHookPath = join(hooksPath, 'reference-transaction')
  writeFileSync(referenceHookPath, referenceHook)
  chmodSync(referenceHookPath, 0o755)

  if (existsSync(originalPostMergeHook)) {
    const postMergeHookPath = join(hooksPath, 'post-merge')
    writeFileSync(
      postMergeHookPath,
      `#!/bin/sh\nexec ${shellQuote(shellPath(originalPostMergeHook))} "$@"\n`
    )
    chmodSync(postMergeHookPath, 0o755)
  }
  return hooksPath
}

export function compensationRoot(this: WorktreeManager): string | undefined {
  const commonDir = this.gitCommonDir(this.baseRepo)
  if (!commonDir) return undefined
  return join(commonDir, 'autowin-compensations')
}

export function compensationPlanPath(this: WorktreeManager, agentId: string): string | undefined {
  assertSafeId(agentId, 'agentId')
  const root = this.compensationRoot()
  return root ? join(root, `${agentId}.json`) : undefined
}

export function compensationPendingPlanPath(
  this: WorktreeManager,
  agentId: string
): string | undefined {
  const planPath = this.compensationPlanPath(agentId)
  return planPath ? `${planPath}.pending` : undefined
}

export function compensationTreeRef(
  this: WorktreeManager,
  agentId: string,
  kind: 'index' | 'worktree' | 'resume-index' | 'resume-worktree' | 'next-index' | 'next-worktree',
  generation?: string
): string {
  assertSafeId(agentId, 'agentId')
  if (generation) assertSafeId(generation, 'generation')
  return `refs/autowin/compensations/${agentId}/${generation ? `${generation}/` : ''}${kind}`
}

export function compensationHooksPath(this: WorktreeManager): string | undefined {
  const root = this.compensationRoot()
  if (!root) return undefined
  const hooksPath = join(root, 'empty-hooks')
  mkdirSync(hooksPath, { recursive: true })
  return hooksPath
}

export function compensationPatchRoot(this: WorktreeManager, agentId: string): string | undefined {
  assertSafeId(agentId, 'agentId')
  const root = this.compensationRoot()
  return root ? join(root, 'patches', agentId) : undefined
}

export function cleanupCompensationPatchResidues(this: WorktreeManager, agentId: string): void {
  const patchRoot = this.compensationPatchRoot(agentId)
  if (!patchRoot || !existsSync(patchRoot)) return
  for (const entry of readdirSync(patchRoot, { withFileTypes: true })) {
    if (entry.isFile() && /^conditional-[A-Za-z0-9-]+\.(?:patch|index)$/.test(entry.name)) {
      rmSync(join(patchRoot, entry.name), { force: true })
    }
  }
  if (readdirSync(patchRoot).length === 0) {
    supprimerArbre(patchRoot)
  }
}

export function compensationIndexLockPath(this: WorktreeManager): string | undefined {
  const indexPathProbe = this.tryGitFn(this.baseRepo, ['rev-parse', '--git-path', 'index'])
  if (indexPathProbe.code !== 0) return undefined
  const rawIndexPath = indexPathProbe.stdout.trim()
  const indexPath = isAbsolute(rawIndexPath) ? rawIndexPath : resolve(this.baseRepo, rawIndexPath)
  return `${indexPath}.lock`
}

export function parseCompensationIndexLockOwner(
  this: WorktreeManager,
  serialized: string
): CompensationIndexLockOwner | undefined {
  try {
    const parsed = JSON.parse(serialized) as Partial<CompensationIndexLockOwner>
    if (
      parsed.owner !== 'autowin-compensation' ||
      !Number.isSafeInteger(parsed.pid) ||
      Number(parsed.pid) <= 0 ||
      (parsed.identity !== null && typeof parsed.identity !== 'string') ||
      typeof parsed.token !== 'string' ||
      !SAFE_ID.test(parsed.token) ||
      ((parsed.predecessorSerialized !== undefined || parsed.acquireExpiresAt !== undefined) &&
        ((parsed.predecessorSerialized !== null &&
          typeof parsed.predecessorSerialized !== 'string') ||
          typeof parsed.acquireExpiresAt !== 'number' ||
          !Number.isFinite(parsed.acquireExpiresAt)))
    ) {
      return undefined
    }
    return parsed as CompensationIndexLockOwner
  } catch {
    return undefined
  }
}

export function compensationIndexOwnershipRef(this: WorktreeManager): string {
  return 'refs/autowin/locks/index'
}

export function isStaleCompensationIndexLock(
  this: WorktreeManager,
  owner: CompensationIndexLockOwner,
  marker: CompensationIndexRecoveryMarker | undefined
): boolean {
  if (marker?.state === 'abandoned') return true
  if (
    (marker?.state === 'acquiring' && this.now() >= marker.expiresAt) ||
    (marker === undefined &&
      owner.acquireExpiresAt !== undefined &&
      this.now() >= owner.acquireExpiresAt)
  ) {
    return true
  }
  const currentIdentity = this.processIdentity(owner.pid)
  if (currentIdentity === undefined) return true
  if (currentIdentity === null || !owner.identity) return false
  return !isSameProcessIdentity(owner.identity, currentIdentity)
}

export function readCompensationIndexLockOwner(
  this: WorktreeManager,
  oid: string
): { owner: CompensationIndexLockOwner; serialized: string } | undefined {
  if (!/^[0-9a-f]{40,64}$/i.test(oid)) return undefined
  const content = this.tryGitFn(this.baseRepo, ['cat-file', '-p', oid])
  if (content.code !== 0) return undefined
  const serialized = content.stdout.trim()
  const owner = this.parseCompensationIndexLockOwner(serialized)
  return owner ? { owner, serialized } : undefined
}

export function releaseCompensationIndexOwnership(
  this: WorktreeManager,
  ref: string,
  oid: string
): boolean {
  const hooksPath = this.compensationHooksPath()
  if (!hooksPath) return false
  const release = this.tryGitFn(this.baseRepo, [
    '-c',
    `core.hooksPath=${shellPath(hooksPath)}`,
    'update-ref',
    '-d',
    ref,
    oid
  ])
  if (release.code === 0) return true
  return this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref]).code !== 0
}

export function cleanupCompensationIndexOwnerResidues(
  this: WorktreeManager,
  ownerRoot: string
): void {
  if (!existsSync(ownerRoot)) return
  const ownership = this.tryGitFn(this.baseRepo, [
    'for-each-ref',
    '--count=1',
    '--format=%(objectname)',
    this.compensationIndexOwnershipRef()
  ])
  let ownershipKnown = ownership.code === 0
  let activeToken: string | undefined
  const ownershipOid = ownership.stdout.trim()
  if (ownershipKnown && ownershipOid) {
    const activeOwner = this.readCompensationIndexLockOwner(ownershipOid)
    if (activeOwner) activeToken = activeOwner.owner.token
    else ownershipKnown = false
  }
  const entreesProprietaires = readdirSync(ownerRoot, { withFileTypes: true })
  this.prechargerEmpreintes(
    entreesProprietaires.map((entree) =>
      Number(/^index-(\d+)-[A-Za-z0-9_-]+\.owner$/.exec(entree.name)?.[1])
    )
  )
  for (const entry of entreesProprietaires) {
    const match = entry.isFile()
      ? /^index-(\d+)-([A-Za-z0-9_-]+)\.owner$/.exec(entry.name)
      : undefined
    if (!match) continue
    const path = join(ownerRoot, entry.name)
    const pid = Number(match[1])
    const token = match[2]
    const currentIdentity = this.processIdentity(pid)
    if (currentIdentity === undefined) {
      rmSync(path, { force: true })
      continue
    }
    if (typeof currentIdentity !== 'string') continue
    try {
      const owner = this.parseCompensationIndexLockOwner(readFileSync(path, 'utf8'))
      if (!owner && ownershipKnown && token !== activeToken) {
        rmSync(path, { force: true })
      } else if (owner?.acquireExpiresAt !== undefined && this.now() >= owner.acquireExpiresAt) {
        rmSync(path, { force: true })
      } else if (owner?.identity && !isSameProcessIdentity(owner.identity, currentIdentity)) {
        rmSync(path, { force: true })
      }
    } catch {
      // Un PID encore vivant interdit de conclure que ce propriétaire partiel est orphelin.
    }
  }
}

export function compensationIndexRecoveryMarkerPath(
  this: WorktreeManager,
  token: string,
  state: CompensationIndexRecoveryMarker['state']
): string | undefined {
  if (!SAFE_ID.test(token)) return undefined
  const root = this.compensationRoot()
  return root ? join(root, 'locks', `${state}-${token}.marker`) : undefined
}

export function parseCompensationIndexRecoveryMarker(
  this: WorktreeManager,
  serialized: string,
  token: string,
  state: CompensationIndexRecoveryMarker['state']
): CompensationIndexRecoveryMarker | undefined {
  try {
    const parsed = JSON.parse(serialized) as Partial<CompensationIndexRecoveryMarker>
    if (
      parsed.version !== 1 ||
      parsed.token !== token ||
      parsed.state !== state ||
      (parsed.predecessorSerialized !== null &&
        (typeof parsed.predecessorSerialized !== 'string' ||
          !this.parseCompensationIndexLockOwner(parsed.predecessorSerialized))) ||
      typeof parsed.expiresAt !== 'number' ||
      !Number.isFinite(parsed.expiresAt)
    ) {
      return undefined
    }
    return parsed as CompensationIndexRecoveryMarker
  } catch {
    return undefined
  }
}

export function readCompensationIndexRecoveryMarker(
  this: WorktreeManager,
  token: string
): CompensationIndexRecoveryMarker | undefined {
  for (const state of ['abandoned', 'acquiring'] as const) {
    const path = this.compensationIndexRecoveryMarkerPath(token, state)
    if (!path || !existsSync(path)) continue
    try {
      const marker = this.parseCompensationIndexRecoveryMarker(
        readFileSync(path, 'utf8'),
        token,
        state
      )
      if (marker) return marker
    } catch {
      // Un marqueur partiel n'autorise aucune reprise destructive.
    }
  }
  return undefined
}

export function persistCompensationIndexRecoveryMarker(
  this: WorktreeManager,
  token: string,
  state: CompensationIndexRecoveryMarker['state'],
  predecessorSerialized: string | null,
  expiresAt = this.now() + COMPENSATION_INDEX_ACQUIRE_MAX_AGE_MS
): boolean {
  const path = this.compensationIndexRecoveryMarkerPath(token, state)
  if (!path) return false
  const marker: CompensationIndexRecoveryMarker = {
    version: 1,
    token,
    state,
    predecessorSerialized,
    expiresAt
  }
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  let fd: number | undefined
  try {
    mkdirSync(dirname(path), { recursive: true })
    fd = openSync(temporaryPath, 'wx')
    writeFileSync(fd, JSON.stringify(marker))
    fsyncSync(fd)
    closeSync(fd)
    fd = undefined
    rmSync(path, { force: true })
    renameSync(temporaryPath, path)
    return true
  } catch {
    return false
  } finally {
    if (fd !== undefined) closeSync(fd)
    rmSync(temporaryPath, { force: true })
  }
}

export function clearCompensationIndexRecoveryMarkers(this: WorktreeManager, token: string): void {
  for (const state of ['acquiring', 'abandoned'] as const) {
    const path = this.compensationIndexRecoveryMarkerPath(token, state)
    if (!path) continue
    try {
      rmSync(path, { force: true })
    } catch {
      // Le marqueur expirera et restera sûr si un antivirus retarde son nettoyage.
    }
  }
}

export function cleanupCompensationIndexRecoveryMarkerResidues(
  this: WorktreeManager,
  ownerRoot: string
): void {
  if (!existsSync(ownerRoot)) return
  const ownership = this.tryGitFn(this.baseRepo, [
    'for-each-ref',
    '--count=1',
    '--format=%(objectname)',
    this.compensationIndexOwnershipRef()
  ])
  if (ownership.code !== 0) return
  let activeToken: string | undefined
  const ownershipOid = ownership.stdout.trim()
  if (ownershipOid) {
    const activeOwner = this.readCompensationIndexLockOwner(ownershipOid)
    if (!activeOwner) return
    activeToken = activeOwner.owner.token
  }

  let inspected = 0
  for (const entry of readdirSync(ownerRoot, { withFileTypes: true })) {
    if (inspected >= COMPENSATION_INDEX_MARKER_SWEEP_LIMIT) break
    const match = entry.isFile()
      ? /^(acquiring|abandoned)-([A-Za-z0-9_-]+)\.marker(?:\.\d+\.[A-Za-z0-9-]+\.tmp)?$/.exec(
          entry.name
        )
      : undefined
    if (!match) continue
    inspected += 1
    const state = match[1] as CompensationIndexRecoveryMarker['state']
    const token = match[2]
    if (token === activeToken) continue
    const path = join(ownerRoot, entry.name)
    try {
      const marker = this.parseCompensationIndexRecoveryMarker(
        readFileSync(path, 'utf8'),
        token,
        state
      )
      if (marker && marker.expiresAt <= this.now()) rmSync(path, { force: true })
    } catch {
      // Une lecture ou suppression transitoirement refusée sera retentée au prochain passage.
    }
  }
}

export function acquireCompensationIndexLock(
  this: WorktreeManager
): CompensationIndexLock | undefined {
  const path = this.compensationIndexLockPath()
  const root = this.compensationRoot()
  const hooksPath = this.compensationHooksPath()
  if (!path || !root || !hooksPath) return undefined
  const ownerBase: CompensationIndexLockOwner = {
    owner: 'autowin-compensation',
    pid: process.pid,
    identity: this.processIdentity(process.pid) ?? null,
    token: randomUUID()
  }
  const ownerRoot = join(root, 'locks')
  const ownerPath = join(ownerRoot, `index-${ownerBase.pid}-${ownerBase.token}.owner`)
  const ownershipRef = this.compensationIndexOwnershipRef()
  let ownerFd: number | undefined
  try {
    mkdirSync(ownerRoot, { recursive: true })
    this.cleanupCompensationIndexOwnerResidues(ownerRoot)
    this.cleanupCompensationIndexRecoveryMarkerResidues(ownerRoot)

    for (let attempt = 0; attempt < 4; attempt += 1) {
      let currentOwner: { owner: CompensationIndexLockOwner; serialized: string } | undefined
      let currentMarker: CompensationIndexRecoveryMarker | undefined
      let currentNativeSerialized: string | undefined
      let predecessorSerialized: string | null = null
      let expectedOid: string | undefined
      const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ownershipRef])
      if (current.code === 0) {
        expectedOid = current.stdout.trim()
        currentOwner = this.readCompensationIndexLockOwner(expectedOid)
        if (!currentOwner) return undefined
        currentMarker = this.readCompensationIndexRecoveryMarker(currentOwner.owner.token)
        currentNativeSerialized = existsSync(path) ? readFileSync(path, 'utf8') : undefined
        if (!this.isStaleCompensationIndexLock(currentOwner.owner, currentMarker)) return undefined
        if (currentNativeSerialized !== undefined) {
          if (
            currentNativeSerialized !== currentOwner.serialized &&
            currentNativeSerialized !== currentMarker?.predecessorSerialized &&
            currentNativeSerialized !== currentOwner.owner.predecessorSerialized
          ) {
            return undefined
          }
          predecessorSerialized = currentNativeSerialized
        } else {
          predecessorSerialized =
            currentMarker?.predecessorSerialized ??
            currentOwner.owner.predecessorSerialized ??
            currentOwner.serialized
        }
      } else if (existsSync(path)) {
        return undefined
      }
      const acquireExpiresAt = this.now() + COMPENSATION_INDEX_ACQUIRE_MAX_AGE_MS
      const owner: CompensationIndexLockOwner = {
        ...ownerBase,
        predecessorSerialized,
        acquireExpiresAt
      }
      const serialized = JSON.stringify(owner)
      if (
        !this.persistCompensationIndexRecoveryMarker(
          owner.token,
          'acquiring',
          predecessorSerialized,
          acquireExpiresAt
        )
      ) {
        return undefined
      }
      rmSync(ownerPath, { force: true })
      ownerFd = openSync(ownerPath, 'wx')
      writeFileSync(ownerFd, serialized)
      fsyncSync(ownerFd)
      closeSync(ownerFd)
      ownerFd = undefined
      const object = this.tryGitFn(this.baseRepo, ['hash-object', '-w', '--', ownerPath])
      const ownershipOid = object.stdout.trim()
      if (object.code !== 0 || !/^[0-9a-f]{40,64}$/i.test(ownershipOid)) return undefined
      expectedOid ??= '0'.repeat(ownershipOid.length)

      const acquireOwnership = this.tryGitFn(this.baseRepo, [
        '-c',
        `core.hooksPath=${shellPath(hooksPath)}`,
        'update-ref',
        ownershipRef,
        ownershipOid,
        expectedOid
      ])
      if (acquireOwnership.code !== 0) {
        this.clearCompensationIndexRecoveryMarkers(owner.token)
        continue
      }

      let nativeLockAcquired = false
      try {
        const ownMarker = this.readCompensationIndexRecoveryMarker(owner.token)
        if (
          ownMarker?.state !== 'acquiring' ||
          ownMarker.expiresAt !== acquireExpiresAt ||
          this.now() >= acquireExpiresAt
        ) {
          return undefined
        }
        if (existsSync(path)) {
          if (!predecessorSerialized || readFileSync(path, 'utf8') !== predecessorSerialized) {
            return undefined
          }
          this.removeIndexLockFn(path)
        }
        this.linkFileFn(ownerPath, path)
        nativeLockAcquired = true
        if (currentOwner) {
          this.clearCompensationIndexRecoveryMarkers(currentOwner.owner.token)
        }
        this.clearCompensationIndexRecoveryMarkers(owner.token)
        return { path, serialized, ownershipRef, ownershipOid, token: owner.token }
      } finally {
        if (!nativeLockAcquired) {
          let predecessorStillPresent = false
          try {
            predecessorStillPresent = Boolean(
              predecessorSerialized &&
              existsSync(path) &&
              readFileSync(path, 'utf8') === predecessorSerialized
            )
          } catch {
            predecessorStillPresent = true
          }
          if (predecessorStillPresent) {
            this.persistCompensationIndexRecoveryMarker(
              owner.token,
              'abandoned',
              predecessorSerialized
            )
          } else if (this.releaseCompensationIndexOwnership(ownershipRef, ownershipOid)) {
            this.clearCompensationIndexRecoveryMarkers(owner.token)
          } else {
            this.persistCompensationIndexRecoveryMarker(owner.token, 'abandoned', serialized)
          }
        }
      }
    }
    return undefined
  } catch {
    return undefined
  } finally {
    if (ownerFd !== undefined) closeSync(ownerFd)
    rmSync(ownerPath, { force: true })
  }
}

export function releaseCompensationIndexLock(
  this: WorktreeManager,
  lock: CompensationIndexLock
): void {
  let nativeLockReleased = false
  try {
    if (!existsSync(lock.path)) {
      nativeLockReleased = true
    } else if (readFileSync(lock.path, 'utf8') === lock.serialized) {
      this.removeIndexLockFn(lock.path)
      nativeLockReleased = !existsSync(lock.path)
    }
  } catch {
    // Le verrou absent ou remplacé n'appartient plus à cette opération.
  }
  if (nativeLockReleased) {
    if (this.releaseCompensationIndexOwnership(lock.ownershipRef, lock.ownershipOid)) {
      this.clearCompensationIndexRecoveryMarkers(lock.token)
    } else {
      this.persistCompensationIndexRecoveryMarker(lock.token, 'abandoned', lock.serialized)
    }
  } else {
    this.persistCompensationIndexRecoveryMarker(lock.token, 'abandoned', lock.serialized)
  }
}

export function ownsCompensationIndexLock(
  this: WorktreeManager,
  lock: CompensationIndexLock,
  minimumRemainingMs = 0
): boolean {
  const owner = this.parseCompensationIndexLockOwner(lock.serialized)
  if (
    !owner ||
    owner.acquireExpiresAt === undefined ||
    this.now() + minimumRemainingMs >= owner.acquireExpiresAt
  ) {
    return false
  }
  try {
    if (!existsSync(lock.path) || readFileSync(lock.path, 'utf8') !== lock.serialized) return false
    const ownership = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', lock.ownershipRef])
    return ownership.code === 0 && ownership.stdout.trim() === lock.ownershipOid
  } catch {
    return false
  }
}

export function reconcileCompensationIndexLock(this: WorktreeManager): void {
  const path = this.compensationIndexLockPath()
  if (!path) return
  const ownership = this.tryGitFn(this.baseRepo, [
    'rev-parse',
    '--verify',
    this.compensationIndexOwnershipRef()
  ])
  if (!existsSync(path) && ownership.code !== 0) return
  const lock = this.acquireCompensationIndexLock()
  if (lock) this.releaseCompensationIndexLock(lock)
}

export function persistCompensationPlan(
  this: WorktreeManager,
  plan: PublicationCompensationPlan
): boolean {
  const planPath = this.compensationPlanPath(plan.agentId)
  const pendingPath = this.compensationPendingPlanPath(plan.agentId)
  const hooksPath = this.compensationHooksPath()
  if (!planPath || !pendingPath || !hooksPath) return false
  mkdirSync(dirname(planPath), { recursive: true })
  const previousGeneration = plan.generation
  const nextPlan: PublicationCompensationPlan = { ...plan, generation: randomUUID() }
  const temporaryPath = `${pendingPath}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporaryPath, JSON.stringify(nextPlan))
    renameSync(temporaryPath, pendingPath)
    if (!this.installCompensationRefs(nextPlan)) {
      this.removeCompensationGeneration(nextPlan)
      rmSync(pendingPath, { force: true })
      return false
    }
    renameSync(pendingPath, planPath)
    Object.assign(plan, nextPlan)
    if (previousGeneration && previousGeneration !== nextPlan.generation) {
      this.removeCompensationGeneration({ ...plan, generation: previousGeneration })
    }
    this.cleanupObsoleteCompensationRefs(plan)
    return true
  } catch {
    rmSync(temporaryPath, { force: true })
    this.removeCompensationGeneration(nextPlan)
    rmSync(pendingPath, { force: true })
    return false
  }
}

export function compensationRefEntries(
  this: WorktreeManager,
  plan: PublicationCompensationPlan
): Array<{
  kind: 'index' | 'worktree' | 'resume-index' | 'resume-worktree' | 'next-index' | 'next-worktree'
  ref: string
  sha: string
}> {
  const entries: Array<
    readonly [
      'index' | 'worktree' | 'resume-index' | 'resume-worktree' | 'next-index' | 'next-worktree',
      string
    ]
  > = [
    ['index', plan.postHookIndexTree],
    ['worktree', plan.postHookWorktreeTree],
    ['resume-index', plan.resumeIndexTree],
    ['resume-worktree', plan.resumeWorktreeTree]
  ]
  if (plan.nextIndexTree && plan.nextWorktreeTree) {
    entries.push(['next-index', plan.nextIndexTree], ['next-worktree', plan.nextWorktreeTree])
  }
  return entries.map(([kind, sha]) => ({
    kind,
    ref: this.compensationTreeRef(plan.agentId, kind, plan.generation),
    sha
  }))
}

export function installCompensationRefs(
  this: WorktreeManager,
  plan: PublicationCompensationPlan
): boolean {
  const hooksPath = this.compensationHooksPath()
  if (!hooksPath || !plan.generation) return false
  for (const { ref, sha } of this.compensationRefEntries(plan)) {
    if (this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${sha}^{tree}`]).code !== 0) return false
    const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
    if (current.code === 0) {
      if (current.stdout.trim() !== sha) return false
      continue
    }
    const install = this.tryGitFn(this.baseRepo, [
      '-c',
      `core.hooksPath=${shellPath(hooksPath)}`,
      'update-ref',
      ref,
      sha,
      '0000000000000000000000000000000000000000'
    ])
    if (install.code !== 0) return false
  }
  return true
}

export function removeCompensationGeneration(
  this: WorktreeManager,
  plan: PublicationCompensationPlan
): boolean {
  const hooksPath = this.compensationHooksPath()
  if (!hooksPath) return false
  const refs = plan.generation
    ? this.tryGitFn(this.baseRepo, [
        'for-each-ref',
        '--format=%(refname)',
        `refs/autowin/compensations/${plan.agentId}/${plan.generation}/`
      ])
        .stdout.split('\n')
        .map((ref) => ref.trim())
        .filter(Boolean)
    : this.compensationRefEntries(plan).map(({ ref }) => ref)
  let removed = true
  for (const ref of refs) {
    const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
    if (current.code !== 0) continue
    if (
      this.tryGitFn(this.baseRepo, [
        '-c',
        `core.hooksPath=${shellPath(hooksPath)}`,
        'update-ref',
        '-d',
        ref,
        current.stdout.trim()
      ]).code !== 0
    ) {
      removed = false
    }
  }
  return removed
}

export function cleanupObsoleteCompensationRefs(
  this: WorktreeManager,
  plan: PublicationCompensationPlan
): void {
  const prefix = `refs/autowin/compensations/${plan.agentId}/`
  const keepPrefix = plan.generation ? `${prefix}${plan.generation}/` : prefix
  const refs = this.tryGitFn(this.baseRepo, ['for-each-ref', '--format=%(refname)', prefix])
  if (refs.code !== 0) return
  const hooksPath = this.compensationHooksPath()
  if (!hooksPath) return
  for (const ref of refs.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)) {
    if (plan.generation ? ref.startsWith(keepPrefix) : !ref.slice(prefix.length).includes('/')) {
      continue
    }
    const current = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
    if (current.code !== 0) continue
    this.tryGitFn(this.baseRepo, [
      '-c',
      `core.hooksPath=${shellPath(hooksPath)}`,
      'update-ref',
      '-d',
      ref,
      current.stdout.trim()
    ])
  }
}

export function areSafeCompensationPaths(this: WorktreeManager, value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((file) => {
      if (
        typeof file !== 'string' ||
        file.length === 0 ||
        file === '.' ||
        file.startsWith(':') ||
        file.includes('\0') ||
        isAbsolute(file)
      ) {
        return false
      }
      const segments = file.split(/[\\/]/)
      if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
        return false
      }
      const confined = relative(resolve(this.baseRepo), resolve(this.baseRepo, file))
      return Boolean(confined) && !confined.startsWith('..') && !isAbsolute(confined)
    })
  )
}

export function readCompensationPlan(
  this: WorktreeManager,
  agentId: string
): PublicationCompensationPlan | 'invalid' | undefined {
  const planPath = this.compensationPlanPath(agentId)
  const pendingPath = this.compensationPendingPlanPath(agentId)
  if (!planPath || !pendingPath) return undefined
  this.cleanupCompensationPatchResidues(agentId)
  this.reconcileCompensationIndexLock()
  if (existsSync(pendingPath)) {
    const pending = this.parseCompensationPlanFile(pendingPath, agentId)
    const current = existsSync(planPath)
      ? this.parseCompensationPlanFile(planPath, agentId)
      : undefined
    if (
      pending === 'invalid' ||
      !pending ||
      current === 'invalid' ||
      (current && !this.sameCompensationIdentity(current, pending)) ||
      !this.installCompensationRefs(pending)
    ) {
      return 'invalid'
    }
    try {
      renameSync(pendingPath, planPath)
      this.cleanupObsoleteCompensationRefs(pending)
    } catch {
      return 'invalid'
    }
  }
  if (!existsSync(planPath)) return undefined
  const plan = this.parseCompensationPlanFile(planPath, agentId)
  if (plan && plan !== 'invalid') this.cleanupObsoleteCompensationRefs(plan)
  return plan
}

export function sameCompensationIdentity(
  this: WorktreeManager,
  current: PublicationCompensationPlan,
  pending: PublicationCompensationPlan
): boolean {
  return (
    current.agentId === pending.agentId &&
    current.baseSha === pending.baseSha &&
    current.publicationSha === pending.publicationSha &&
    current.expectedBaseBranch === pending.expectedBaseBranch &&
    current.branchPublished === pending.branchPublished &&
    current.postHookIndexTree === pending.postHookIndexTree &&
    current.postHookWorktreeTree === pending.postHookWorktreeTree &&
    JSON.stringify(current.agentFiles) === JSON.stringify(pending.agentFiles) &&
    JSON.stringify(current.indexedAgentPaths) === JSON.stringify(pending.indexedAgentPaths) &&
    JSON.stringify(current.worktreeAgentPaths) === JSON.stringify(pending.worktreeAgentPaths) &&
    JSON.stringify(current.untrackedAgentPaths) === JSON.stringify(pending.untrackedAgentPaths)
  )
}

export function parseCompensationPlanFile(
  this: WorktreeManager,
  planPath: string,
  agentId: string
): PublicationCompensationPlan | 'invalid' | undefined {
  if (!existsSync(planPath)) return undefined
  try {
    const plan = JSON.parse(readFileSync(planPath, 'utf8')) as Partial<PublicationCompensationPlan>
    const sha = (value: unknown): value is string =>
      typeof value === 'string' && /^[0-9a-f]{40,64}$/i.test(value)
    if (
      plan.version !== 2 ||
      plan.agentId !== agentId ||
      (plan.generation !== undefined &&
        (typeof plan.generation !== 'string' || !SAFE_ID.test(plan.generation))) ||
      (plan.phase !== undefined && plan.phase !== 'pending' && plan.phase !== 'compensated') ||
      plan.stage === undefined ||
      ![0, 1, 2, 3, 4].includes(plan.stage) ||
      !sha(plan.baseSha) ||
      !sha(plan.publicationSha) ||
      typeof plan.expectedBaseBranch !== 'string' ||
      this.tryGitFn(this.baseRepo, ['check-ref-format', `refs/heads/${plan.expectedBaseBranch}`])
        .code !== 0 ||
      typeof plan.branchPublished !== 'boolean' ||
      !this.areSafeCompensationPaths(plan.agentFiles) ||
      !this.areSafeCompensationPaths(plan.indexedAgentPaths) ||
      !this.areSafeCompensationPaths(plan.worktreeAgentPaths) ||
      !this.areSafeCompensationPaths(plan.untrackedAgentPaths) ||
      !sha(plan.postHookIndexTree) ||
      !sha(plan.postHookWorktreeTree) ||
      !sha(plan.resumeIndexTree) ||
      !sha(plan.resumeWorktreeTree) ||
      (plan.nextIndexTree === undefined) !== (plan.nextWorktreeTree === undefined) ||
      (plan.nextIndexTree !== undefined && !sha(plan.nextIndexTree)) ||
      (plan.nextWorktreeTree !== undefined && !sha(plan.nextWorktreeTree))
    ) {
      return 'invalid'
    }
    const agentFiles = new Set(plan.agentFiles)
    if (
      ![plan.indexedAgentPaths, plan.worktreeAgentPaths, plan.untrackedAgentPaths].every((items) =>
        items.every((file) => agentFiles.has(file))
      )
    ) {
      return 'invalid'
    }
    return { ...plan, phase: plan.phase ?? 'pending' } as PublicationCompensationPlan
  } catch {
    return 'invalid'
  }
}

export function clearCompensationPlan(
  this: WorktreeManager,
  plan: PublicationCompensationPlan
): boolean {
  const planPath = this.compensationPlanPath(plan.agentId)
  const pendingPath = this.compensationPendingPlanPath(plan.agentId)
  if (!planPath || !pendingPath || !this.removeCompensationGeneration(plan)) return false
  try {
    rmSync(planPath, { force: true })
    rmSync(pendingPath, { force: true })
    this.cleanupCompensationPatchResidues(plan.agentId)
    return true
  } catch {
    return false
  }
}

export function compensationPlanFromHooks(
  this: WorktreeManager,
  agentId: string,
  publishHooksPath: string,
  agentFiles: string[],
  baseSha: string,
  publicationSha: string,
  expectedBaseBranch: string,
  branchPublished = true
): PublicationCompensationPlan | undefined {
  const indexedAgentPathsFile = join(publishHooksPath, 'post-hook-indexed-agent-paths')
  const indexedAgentPaths = existsSync(indexedAgentPathsFile)
    ? parseNullSeparatedPaths(readFileSync(indexedAgentPathsFile, 'utf8'))
    : []
  const worktreeAgentPathsFile = join(publishHooksPath, 'post-hook-worktree-agent-paths')
  const worktreeAgentPaths = existsSync(worktreeAgentPathsFile)
    ? parseNullSeparatedPaths(readFileSync(worktreeAgentPathsFile, 'utf8'))
    : []
  const untrackedAgentPathsFile = join(publishHooksPath, 'post-hook-untracked-agent-paths')
  const untrackedAgentPaths = existsSync(untrackedAgentPathsFile)
    ? parseNullSeparatedPaths(readFileSync(untrackedAgentPathsFile, 'utf8'))
    : []
  const postHookIndexTreeFile = join(publishHooksPath, 'post-hook-index-tree')
  const postHookWorktreeTreeFile = join(publishHooksPath, 'post-hook-worktree-tree')
  const postHookIndexTree = existsSync(postHookIndexTreeFile)
    ? readFileSync(postHookIndexTreeFile, 'utf8').trim()
    : ''
  const postHookWorktreeTree = existsSync(postHookWorktreeTreeFile)
    ? readFileSync(postHookWorktreeTreeFile, 'utf8').trim()
    : ''
  const plan: PublicationCompensationPlan = {
    version: 2,
    phase: 'pending',
    stage: 0,
    agentId,
    baseSha,
    publicationSha,
    expectedBaseBranch,
    branchPublished,
    agentFiles,
    indexedAgentPaths,
    worktreeAgentPaths,
    untrackedAgentPaths,
    postHookIndexTree,
    postHookWorktreeTree,
    resumeIndexTree: postHookIndexTree,
    resumeWorktreeTree: postHookWorktreeTree
  }
  if (
    !/^[0-9a-f]{40,64}$/i.test(postHookIndexTree) ||
    !/^[0-9a-f]{40,64}$/i.test(postHookWorktreeTree) ||
    !this.areSafeCompensationPaths(agentFiles) ||
    ![indexedAgentPaths, worktreeAgentPaths, untrackedAgentPaths].every(
      (paths) =>
        this.areSafeCompensationPaths(paths) && paths.every((path) => agentFiles.includes(path))
    )
  ) {
    return undefined
  }
  return plan
}

export function compensationPlanRefsMatch(
  this: WorktreeManager,
  plan: PublicationCompensationPlan
): boolean {
  return this.compensationRefEntries(plan).every(({ ref, sha }) => {
    const currentTree = this.tryGitFn(this.baseRepo, ['rev-parse', '--verify', ref])
    return currentTree.code === 0 && currentTree.stdout.trim() === sha
  })
}

export function promoteCompensationResidue(
  this: WorktreeManager,
  integrationPath: string
): { ok: boolean; detail?: string } {
  const hooksPath = join(integrationPath, '.autowin-publish-hooks')
  if (
    !existsSync(join(hooksPath, 'post-hook-change')) ||
    existsSync(join(hooksPath, 'compensation-complete'))
  ) {
    return { ok: true }
  }
  const intentPath = join(hooksPath, 'compensation-intent.json')
  if (!existsSync(intentPath)) {
    return { ok: false, detail: 'Intention de compensation absente : copie conservée.' }
  }
  let intent: Partial<PublicationCompensationIntent>
  try {
    intent = JSON.parse(readFileSync(intentPath, 'utf8')) as Partial<PublicationCompensationIntent>
  } catch {
    return { ok: false, detail: 'Intention de compensation illisible : copie conservée.' }
  }
  if (
    intent.version !== 1 ||
    typeof intent.agentId !== 'string' ||
    !SAFE_ID.test(intent.agentId) ||
    typeof intent.baseSha !== 'string' ||
    !/^[0-9a-f]{40,64}$/i.test(intent.baseSha) ||
    typeof intent.publicationSha !== 'string' ||
    !/^[0-9a-f]{40,64}$/i.test(intent.publicationSha) ||
    typeof intent.expectedBaseBranch !== 'string' ||
    this.tryGitFn(this.baseRepo, ['check-ref-format', `refs/heads/${intent.expectedBaseBranch}`])
      .code !== 0 ||
    !this.areSafeCompensationPaths(intent.agentFiles)
  ) {
    return { ok: false, detail: 'Intention de compensation invalide : copie conservée.' }
  }
  const currentPlan = this.readCompensationPlan(intent.agentId)
  if (currentPlan === 'invalid') {
    return { ok: false, detail: 'Plan de compensation invalide : copie conservée.' }
  }
  if (currentPlan) {
    if (
      currentPlan.baseSha !== intent.baseSha ||
      currentPlan.publicationSha !== intent.publicationSha ||
      currentPlan.expectedBaseBranch !== intent.expectedBaseBranch ||
      !this.compensationPlanRefsMatch(currentPlan)
    ) {
      return { ok: false, detail: 'Plan de compensation incohérent : copie conservée.' }
    }
    return { ok: true }
  }
  const branch = this.tryGitFn(this.baseRepo, [
    'rev-parse',
    '--verify',
    `refs/heads/${intent.expectedBaseBranch}`
  ])
  if (
    branch.code !== 0 ||
    ![intent.baseSha, intent.publicationSha].includes(branch.stdout.trim())
  ) {
    return {
      ok: false,
      detail: 'La branche a divergé avant la reprise de compensation : copie conservée.'
    }
  }
  const plan = this.compensationPlanFromHooks(
    intent.agentId,
    hooksPath,
    intent.agentFiles,
    intent.baseSha,
    intent.publicationSha,
    intent.expectedBaseBranch,
    branch.stdout.trim() === intent.publicationSha
  )
  if (!plan || !this.persistCompensationPlan(plan)) {
    return {
      ok: false,
      detail: 'Les snapshots de compensation n’ont pas pu être promus durablement.'
    }
  }
  return { ok: true }
}

export function compensatePostHookChange(
  this: WorktreeManager,
  agentId: string,
  publishHooksPath: string,
  agentFiles: string[],
  baseSha: string,
  publicationSha: string,
  expectedBaseBranch: string,
  branchPublished = true
): { ok: boolean; files: string[]; detail?: string } {
  const plan = this.compensationPlanFromHooks(
    agentId,
    publishHooksPath,
    agentFiles,
    baseSha,
    publicationSha,
    expectedBaseBranch,
    branchPublished
  )
  if (!plan) {
    return {
      ok: false,
      files: this.workingTreeFiles(this.baseRepo),
      detail: 'Les snapshots du hook sont invalides ; la copie d’intégration est conservée.'
    }
  }
  const currentCheckpoint = this.snapshotCompensationWorkspace(agentFiles)
  if (
    !currentCheckpoint ||
    currentCheckpoint.indexTree !== plan.resumeIndexTree ||
    currentCheckpoint.worktreeTree !== plan.resumeWorktreeTree
  ) {
    return {
      ok: false,
      files: this.workingTreeFiles(this.baseRepo),
      detail:
        'Le workspace a changé après le hook ; aucune compensation automatique n’a été appliquée.'
    }
  }
  if (!this.persistCompensationPlan(plan)) {
    return {
      ok: false,
      files: this.workingTreeFiles(this.baseRepo),
      detail: 'Le plan durable de compensation n’a pas pu être enregistré avant la restauration.'
    }
  }
  const compensation = this.applyCompensationPlan(plan, true)
  if (compensation.ok) {
    try {
      writeFileSync(join(publishHooksPath, 'compensation-complete'), '')
    } catch {
      return {
        ok: false,
        files: compensation.files,
        detail: 'La compensation terminée n’a pas pu être marquée durablement.'
      }
    }
    if (!this.clearCompensationPlan(plan)) {
      return {
        ok: false,
        files: compensation.files,
        detail: 'Le plan compensé reste en attente d’acquittement durable.'
      }
    }
  }
  return compensation
}

export function snapshotCompensationWorkspace(
  this: WorktreeManager,
  agentFiles: string[]
): { indexTree: string; worktreeTree: string } | undefined {
  const root = this.compensationRoot()
  const indexPathProbe = this.tryGitFn(this.baseRepo, ['rev-parse', '--git-path', 'index'])
  if (!root || indexPathProbe.code !== 0) return undefined
  const rawIndexPath = indexPathProbe.stdout.trim()
  const indexPath = isAbsolute(rawIndexPath) ? rawIndexPath : resolve(this.baseRepo, rawIndexPath)
  const temporaryIndex = join(root, `checkpoint-${randomUUID()}.index`)
  mkdirSync(root, { recursive: true })
  try {
    copyFileSync(indexPath, temporaryIndex)
    const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex }
    const indexTree = execFileSync('git', ['write-tree'], {
      cwd: this.baseRepo,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    if (agentFiles.length > 0) {
      const tracked = new Set(
        parseNullSeparatedPaths(
          execFileSync('git', ['ls-files', '-z', '--', ...agentFiles], {
            cwd: this.baseRepo,
            env,
            encoding: 'utf8',
            windowsHide: true,
            timeout: GIT_COMMAND_TIMEOUT_MS,
            stdio: ['ignore', 'pipe', 'pipe']
          })
        )
      )
      const snapshotFiles = agentFiles.filter(
        (file) => tracked.has(file) || existsSync(resolve(this.baseRepo, file))
      )
      if (snapshotFiles.length > 0) {
        execFileSync('git', ['add', '-A', '-f', '--', ...snapshotFiles], {
          cwd: this.baseRepo,
          env,
          encoding: 'utf8',
          windowsHide: true,
          timeout: GIT_COMMAND_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'pipe']
        })
      }
    }
    const worktreeTree = execFileSync('git', ['write-tree'], {
      cwd: this.baseRepo,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    if (!/^[0-9a-f]{40,64}$/i.test(indexTree) || !/^[0-9a-f]{40,64}$/i.test(worktreeTree)) {
      return undefined
    }
    return { indexTree, worktreeTree }
  } catch {
    return undefined
  } finally {
    rmSync(temporaryIndex, { force: true })
  }
}

export function transformCompensationTree(
  this: WorktreeManager,
  currentTree: string,
  sourceTree: string,
  paths: string[]
): string | undefined {
  if (paths.length === 0) return currentTree
  const root = this.compensationRoot()
  if (!root) return undefined
  mkdirSync(root, { recursive: true })
  const temporaryIndex = join(root, `transform-${randomUUID()}.index`)
  const env = { ...process.env, GIT_INDEX_FILE: temporaryIndex }
  try {
    execFileSync('git', ['read-tree', currentTree], {
      cwd: this.baseRepo,
      env,
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    execFileSync('git', ['restore', `--source=${sourceTree}`, '--staged', '--', ...paths], {
      cwd: this.baseRepo,
      env,
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    const tree = execFileSync('git', ['write-tree'], {
      cwd: this.baseRepo,
      env,
      encoding: 'utf8',
      windowsHide: true,
      timeout: GIT_COMMAND_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'pipe']
    }).trim()
    return /^[0-9a-f]{40,64}$/i.test(tree) ? tree : undefined
  } catch {
    return undefined
  } finally {
    rmSync(temporaryIndex, { force: true })
  }
}

export function compensationCheckpointMatches(
  this: WorktreeManager,
  checkpoint: { indexTree: string; worktreeTree: string } | undefined,
  indexTree: string,
  worktreeTree: string
): boolean {
  return Boolean(
    checkpoint && checkpoint.indexTree === indexTree && checkpoint.worktreeTree === worktreeTree
  )
}

/**
 * Applique une transition seulement si son préimage est encore présent. Contrairement à
 * `restore`, `git apply` vérifie le contenu dans la commande qui écrit ; `--cached` bénéficie en
 * plus du verrou natif de l’index. Pour un patch worktree, un vrai `index.lock` est tenu depuis la
 * validation de l’arbre index jusqu’à la fin du patch.
 */
export function applyCompensationTreePatch(
  this: WorktreeManager,
  agentId: string,
  expectedIndexTree: string,
  currentTree: string,
  nextTree: string,
  paths: string[],
  channel: 'index' | 'worktree'
): boolean {
  if (currentTree === nextTree || paths.length === 0) return true
  const patchRoot = this.compensationPatchRoot(agentId)
  if (!patchRoot) return false
  mkdirSync(patchRoot, { recursive: true })
  const operationId = randomUUID()
  const patchPath = join(patchRoot, `conditional-${operationId}.patch`)
  const indexSnapshotPath = join(patchRoot, `conditional-${operationId}.index`)
  let indexLock: CompensationIndexLock | undefined
  try {
    const patch = execFileSync(
      'git',
      ['diff', '--binary', '--full-index', currentTree, nextTree, '--', ...paths],
      {
        cwd: this.baseRepo,
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    )
    if (patch.length === 0) return true
    writeFileSync(patchPath, patch)
    if (channel === 'worktree') {
      indexLock = this.acquireCompensationIndexLock()
      if (!indexLock) return false
      copyFileSync(indexLock.path.slice(0, -'.lock'.length), indexSnapshotPath)
      const currentIndexTree = execFileSync('git', ['write-tree'], {
        cwd: this.baseRepo,
        env: { ...process.env, GIT_INDEX_FILE: indexSnapshotPath },
        encoding: 'utf8',
        windowsHide: true,
        timeout: GIT_COMMAND_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'pipe']
      }).trim()
      if (currentIndexTree !== expectedIndexTree) return false
    }
    if (
      channel === 'worktree' &&
      (!indexLock || !this.ownsCompensationIndexLock(indexLock, GIT_COMMAND_TIMEOUT_MS))
    ) {
      return false
    }
    const apply = this.tryGitFn(this.baseRepo, [
      'apply',
      '--binary',
      ...(channel === 'index' ? ['--cached'] : ['--no-index']),
      patchPath
    ])
    return apply.code === 0
  } catch {
    return false
  } finally {
    if (indexLock) this.releaseCompensationIndexLock(indexLock)
    rmSync(patchPath, { force: true })
    rmSync(indexSnapshotPath, { force: true })
    if (existsSync(patchRoot) && readdirSync(patchRoot).length === 0) {
      supprimerArbre(patchRoot)
    }
  }
}

export function applyCompensationPlan(
  this: WorktreeManager,
  plan: PublicationCompensationPlan,
  deferClear = false
): {
  ok: boolean
  files: string[]
  detail?: string
} {
  const {
    agentId,
    agentFiles,
    baseSha,
    publicationSha,
    expectedBaseBranch,
    branchPublished,
    indexedAgentPaths,
    worktreeAgentPaths,
    untrackedAgentPaths,
    postHookIndexTree,
    postHookWorktreeTree
  } = plan
  const currentBranch = this.tryGitFn(this.baseRepo, [
    'rev-parse',
    '--verify',
    `refs/heads/${expectedBaseBranch}`
  ])
  if (currentBranch.code !== 0) {
    return {
      ok: false,
      files: this.workingTreeFiles(this.baseRepo),
      detail: 'La branche à compenser est devenue introuvable.'
    }
  }
  if (branchPublished && currentBranch.stdout.trim() === publicationSha) {
    const rollbackHooksPath = this.compensationHooksPath()
    if (!rollbackHooksPath) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'Le répertoire de hooks neutres est indisponible pour la compensation.'
      }
    }
    const rollback = this.tryGitFn(this.baseRepo, [
      '-c',
      `core.hooksPath=${shellPath(rollbackHooksPath)}`,
      'update-ref',
      `refs/heads/${expectedBaseBranch}`,
      baseSha,
      publicationSha
    ])
    if (rollback.code !== 0) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail:
          'La branche publiée n’a pas pu être restaurée sans course après le hook utilisateur.'
      }
    }
  } else if (currentBranch.stdout.trim() !== baseSha) {
    return {
      ok: false,
      files: this.workingTreeFiles(this.baseRepo),
      detail: 'La branche a avancé ailleurs pendant la compensation ; aucune restauration risquée.'
    }
  }

  if (plan.phase === 'compensated') {
    const files = this.workingTreeFiles(this.baseRepo)
    if (!this.acknowledgePublication(agentId, publicationSha)) {
      return {
        ok: false,
        files,
        detail: 'La publication compensée n’a pas pu être libérée sans course.'
      }
    }
    if (!deferClear && !this.clearCompensationPlan(plan)) {
      return {
        ok: false,
        files,
        detail: 'Le plan durable compensé n’a pas pu être acquitté.'
      }
    }
    return { ok: true, files }
  }

  const userWorktreeAgentFiles = [...new Set([...worktreeAgentPaths, ...untrackedAgentPaths])]
  while (plan.stage < 4) {
    const stage = plan.stage
    const steps: ReadonlyArray<{
      source: string
      paths: string[]
      channel: 'index' | 'worktree'
      failure: string
    }> = [
      {
        source: baseSha,
        paths: agentFiles,
        channel: 'index',
        failure: 'L’index antérieur n’a pas pu être restauré sans toucher au contenu utilisateur.'
      },
      {
        source: postHookIndexTree,
        paths: indexedAgentPaths,
        channel: 'index',
        failure: 'L’index produit par le hook n’a pas pu être réappliqué.'
      },
      {
        source: baseSha,
        paths: agentFiles,
        channel: 'worktree',
        failure: 'Le contenu agent n’a pas pu être retiré du worktree sans écrasement.'
      },
      {
        source: postHookWorktreeTree,
        paths: userWorktreeAgentFiles,
        channel: 'worktree',
        failure: 'Le contenu produit par le hook n’a pas pu être réappliqué.'
      }
    ]
    const step = steps[stage]
    if (!step) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'Le plan de compensation contient une étape invalide.'
      }
    }

    if (step.paths.length === 0) {
      plan.stage = (stage + 1) as 1 | 2 | 3 | 4
      if (!this.persistCompensationPlan(plan)) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'L’avancement du plan de compensation n’a pas pu être persisté.'
        }
      }
      continue
    }

    if (plan.nextIndexTree && plan.nextWorktreeTree) {
      const checkpoint = this.snapshotCompensationWorkspace(agentFiles)
      if (
        this.compensationCheckpointMatches(checkpoint, plan.nextIndexTree, plan.nextWorktreeTree)
      ) {
        plan.resumeIndexTree = plan.nextIndexTree
        plan.resumeWorktreeTree = plan.nextWorktreeTree
        plan.nextIndexTree = undefined
        plan.nextWorktreeTree = undefined
        plan.stage = (stage + 1) as 1 | 2 | 3 | 4
        if (!this.persistCompensationPlan(plan)) {
          return {
            ok: false,
            files: this.workingTreeFiles(this.baseRepo),
            detail: 'L’étape compensée n’a pas pu être acquittée durablement.'
          }
        }
        continue
      }
      if (
        !this.compensationCheckpointMatches(
          checkpoint,
          plan.resumeIndexTree,
          plan.resumeWorktreeTree
        )
      ) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail:
            'Le workspace a changé pendant une étape de compensation ; aucune mutation supplémentaire.'
        }
      }
    } else {
      const nextIndexTree =
        step.channel === 'index'
          ? this.transformCompensationTree(plan.resumeIndexTree, step.source, step.paths)
          : plan.resumeIndexTree
      const nextWorktreeTree =
        step.channel === 'worktree'
          ? this.transformCompensationTree(plan.resumeWorktreeTree, step.source, step.paths)
          : plan.resumeWorktreeTree
      if (!nextIndexTree || !nextWorktreeTree) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'La cible de l’étape de compensation n’a pas pu être calculée.'
        }
      }
      plan.nextIndexTree = nextIndexTree
      plan.nextWorktreeTree = nextWorktreeTree
      if (!this.persistCompensationPlan(plan)) {
        return {
          ok: false,
          files: this.workingTreeFiles(this.baseRepo),
          detail: 'La cible de l’étape de compensation n’a pas pu être ancrée durablement.'
        }
      }
    }

    const beforeMutation = this.snapshotCompensationWorkspace(agentFiles)
    if (
      !this.compensationCheckpointMatches(
        beforeMutation,
        plan.resumeIndexTree,
        plan.resumeWorktreeTree
      )
    ) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'Le workspace a changé juste avant la restauration ; aucune mutation automatique.'
      }
    }

    const currentTree = step.channel === 'index' ? plan.resumeIndexTree : plan.resumeWorktreeTree
    const nextTree = step.channel === 'index' ? plan.nextIndexTree : plan.nextWorktreeTree
    if (
      !nextTree ||
      !this.applyCompensationTreePatch(
        agentId,
        plan.resumeIndexTree,
        currentTree,
        nextTree,
        step.paths,
        step.channel
      )
    ) {
      return { ok: false, files: this.workingTreeFiles(this.baseRepo), detail: step.failure }
    }
    const afterMutation = this.snapshotCompensationWorkspace(agentFiles)
    if (
      !plan.nextIndexTree ||
      !plan.nextWorktreeTree ||
      !this.compensationCheckpointMatches(afterMutation, plan.nextIndexTree, plan.nextWorktreeTree)
    ) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'L’étape de compensation ne correspond pas à sa cible durable.'
      }
    }
    plan.resumeIndexTree = plan.nextIndexTree
    plan.resumeWorktreeTree = plan.nextWorktreeTree
    plan.nextIndexTree = undefined
    plan.nextWorktreeTree = undefined
    plan.stage = (stage + 1) as 1 | 2 | 3 | 4
    if (!this.persistCompensationPlan(plan)) {
      return {
        ok: false,
        files: this.workingTreeFiles(this.baseRepo),
        detail: 'L’étape de compensation appliquée n’a pas pu être acquittée durablement.'
      }
    }
  }

  Object.assign(plan, { phase: 'compensated' as const })
  if (!this.persistCompensationPlan(plan)) {
    return {
      ok: false,
      files: this.workingTreeFiles(this.baseRepo),
      detail: 'L’état compensé n’a pas pu être persisté avant acquittement.'
    }
  }
  const files = this.workingTreeFiles(this.baseRepo)
  if (!this.acknowledgePublication(agentId, publicationSha)) {
    return {
      ok: false,
      files,
      detail: 'La publication compensée n’a pas pu être libérée sans course.'
    }
  }
  if (!deferClear && !this.clearCompensationPlan(plan)) {
    return {
      ok: false,
      files,
      detail: 'Le plan durable compensé n’a pas pu être acquitté.'
    }
  }
  return { ok: true, files }
}

export function resumePendingCompensation(
  this: WorktreeManager,
  agentId: string,
  expectedBaseBranch: string
): FinalizeResult | undefined {
  const plan = this.readCompensationPlan(agentId)
  if (!plan) return undefined
  if (plan === 'invalid') {
    return {
      outcome: 'blocked',
      agentId,
      files: this.workingTreeFiles(this.baseRepo),
      reason: 'merge-failed',
      preserveAgentFiles: true,
      detail: 'Le plan durable de compensation est invalide ; aucune mutation automatique.'
    }
  }
  if (
    plan.expectedBaseBranch !== expectedBaseBranch ||
    !this.isExpectedBaseBranch(expectedBaseBranch)
  ) {
    return {
      outcome: 'blocked',
      agentId,
      files: this.workingTreeFiles(this.baseRepo),
      reason: 'merge-failed',
      preserveAgentFiles: true,
      detail: 'Le contexte Git ne correspond plus au plan durable de compensation.'
    }
  }
  const publicationRef = this.tryGitFn(this.baseRepo, [
    'rev-parse',
    '--verify',
    this.publicationMarkerRef(agentId)
  ])
  if (publicationRef.code === 0 && publicationRef.stdout.trim() !== plan.publicationSha) {
    return {
      outcome: 'blocked',
      agentId,
      files: this.workingTreeFiles(this.baseRepo),
      reason: 'merge-failed',
      preserveAgentFiles: true,
      detail: 'L’ancre de publication ne correspond plus au plan durable de compensation.'
    }
  }
  if (plan.phase === 'compensated') {
    const compensation = this.applyCompensationPlan(plan)
    return {
      outcome: 'blocked',
      agentId,
      files: compensation.files,
      reason: compensation.ok ? 'base-in-progress' : 'merge-failed',
      preserveAgentFiles: true,
      detail: compensation.ok
        ? 'La compensation terminée a été acquittée après reprise.'
        : compensation.detail
    }
  }
  const compensationTrees = [
    plan.postHookIndexTree,
    plan.postHookWorktreeTree,
    plan.resumeIndexTree,
    plan.resumeWorktreeTree,
    plan.nextIndexTree,
    plan.nextWorktreeTree
  ].filter((tree): tree is string => Boolean(tree))
  for (const tree of compensationTrees) {
    if (this.tryGitFn(this.baseRepo, ['cat-file', '-e', `${tree}^{tree}`]).code !== 0) {
      return {
        outcome: 'blocked',
        agentId,
        files: this.workingTreeFiles(this.baseRepo),
        reason: 'merge-failed',
        preserveAgentFiles: true,
        detail: 'Un arbre requis par le plan durable de compensation est indisponible.'
      }
    }
  }
  if (!this.compensationPlanRefsMatch(plan)) {
    return {
      outcome: 'blocked',
      agentId,
      files: this.workingTreeFiles(this.baseRepo),
      reason: 'merge-failed',
      preserveAgentFiles: true,
      detail: 'Les ancres Git du plan durable de compensation sont incohérentes.'
    }
  }
  const compensation = this.applyCompensationPlan(plan)
  return {
    outcome: 'blocked',
    agentId,
    files: compensation.files,
    reason: compensation.ok ? 'base-in-progress' : 'merge-failed',
    preserveAgentFiles: true,
    detail: compensation.ok
      ? 'La compensation interrompue a été reprise ; le travail utilisateur est préservé.'
      : compensation.detail
  }
}
