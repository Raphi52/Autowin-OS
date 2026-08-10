import { parentPort, workerData } from 'node:worker_threads'
import { WorktreeManager } from './worktree-manager'
import type { WorktreeOperationRequest } from './worktree-operation-protocol'

if (!parentPort) throw new Error('worktree-operation-worker doit être exécuté dans un Worker')
const port = parentPort

const data = workerData as {
  baseRepo: string
  worktreeRoot: string
  baseBranch?: string
  requireCanonicalRemote?: boolean
}
const manager = new WorktreeManager({
  baseRepo: data.baseRepo,
  worktreeRoot: data.worktreeRoot,
  ...(data.baseBranch ? { baseBranch: data.baseBranch } : {}),
  requireCanonicalRemote: data.requireCanonicalRemote,
  disableAsyncOperations: true
})

port.on('message', (request: WorktreeOperationRequest) => {
  try {
    let value: unknown
    switch (request.operation) {
      case 'prepare': {
        const context = request.context ?? manager.describeForLaunch(request.agentId)
        value = { context, path: manager.acquire(request.agentId, context) }
        break
      }
      case 'changedFiles':
        value = manager.changedFiles(request.agentId)
        break
      case 'finalize':
        value = manager.finalize(request.agentId, {
          ...request.options,
          onPrepared: (agentSha, baseSha) =>
            port.postMessage({ type: 'prepared', agentSha, baseSha })
        })
        break
      case 'cleanupPublished':
        value = manager.cleanupPublished(
          request.agentId,
          request.expectedSha,
          request.baseBranch
        )
        break
      case 'recoveryInventory':
        value = manager.recoveryInventory()
        break
      case 'describe':
        value = manager.describe(request.agentId)
        break
      case 'hasActiveProcesses':
        value = manager.hasActiveProcesses(request.agentId)
        break
      case 'discard':
        manager.discard(request.agentId)
        value = true
        break
      case 'validateRecoveryContext':
        value = manager.validateRecoveryContext(request.agentId, request.context)
        break
      case 'readConflictDiff':
        value = manager.readConflictDiff(request.agentId, request.snapshot)
        break
    }
    port.postMessage({ type: 'result', value })
  } catch (error) {
    port.postMessage({
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
