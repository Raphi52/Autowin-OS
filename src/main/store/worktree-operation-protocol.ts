import type { WorktreeRecoveryContext, WorktreeRunContext } from './worktree-manager'

export interface WorktreeRecoveryInventory {
  residues: {
    cleaned: number
    recovered: string[]
    blocked: Array<{ path: string; detail: string }>
    swept?: string[]
  }
  agents: Array<{
    agentId: string
    context?: WorktreeRunContext
    active: boolean
    changedFiles: string[]
  }>
}

export type WorktreeOperationRequest =
  | { operation: 'prepare'; agentId: string; context?: WorktreeRunContext }
  | { operation: 'changedFiles'; agentId: string }
  | {
      operation: 'finalize'
      agentId: string
      options?: { baseBranch?: string; expectedAgentSha?: string }
    }
  | {
      operation: 'cleanupPublished'
      agentId: string
      publishedSha: string
      agentSha: string
      baseBranch?: string
    }
  | { operation: 'acknowledgePublication'; agentId: string; publishedSha: string }
  | { operation: 'recoveryInventory' }
  | { operation: 'describe'; agentId: string }
  | { operation: 'hasActiveProcesses'; agentId: string }
  | { operation: 'discard'; agentId: string }
  | { operation: 'validateRecoveryContext'; agentId: string; context: WorktreeRecoveryContext }
  | {
      operation: 'readConflictDiff'
      agentId: string
      snapshot: { files: string[]; baseSha: string; agentSha: string }
    }

export type WorktreeOperationResponse =
  | { type: 'prepared'; agentSha: string; baseSha: string }
  | { type: 'integrated'; integratedSha: string; agentSha: string; baseSha: string }
  | { type: 'result'; value: unknown }
  | { type: 'error'; error: string }
