export type RunWorkspaceMode = 'base' | 'worktree'
export type RunGitOutcome = 'merged' | 'nothing' | 'conflict' | 'blocked' | 'kept'
export type RunClosureStatus = 'open' | 'green' | 'degraded-closed' | 'red'

export interface RunExecutionQuoteObservation {
  quoteId: string
  regime: 'trivial' | 'standard' | 'critical'
  phases: string[]
  decomposition: { mode: 'disabled' | 'build-only'; maxNodes: number }
  limits: {
    maxProviderCalls: number
    maxFreshTokens: number
    maxTotalTokens: number
    maxAgents: number
    maxConcurrency: number
    maxDurationMs: number
    maxRecoveries: number
    maxUsd: number | null
  }
  allocation?: {
    phaseMembers: Partial<Record<string, number>>
    judgeMembers: number
    maxGreedyNodes: number
    reservedMandatoryAgents: number
    estimatedMaxAgents: number
    estimatedMaxCalls: number
  }
}

export interface RunWorkspaceObservation {
  mode: RunWorkspaceMode
  /** Dépôt de travail qui porte le tronc commun de la conversation. */
  repositoryPath: string
  /** Chemin effectivement donné aux agents : copie isolée ou dépôt de travail. */
  path: string
  baseBranch?: string
  baseSha?: string
}

export interface RunGitObservation {
  /** Sort produit pour l'interface ; `rawOutcome` conserve la valeur exacte du moteur. */
  outcome: RunGitOutcome
  rawOutcome?: string
  commitSha?: string
  baseBranch?: string
  worktreePath?: string
  files?: string[]
  reason?: string
  detail?: string
}

export interface RunClosureObservation {
  status: RunClosureStatus
  totalDurationMs: number
  totalCostUsd: number
  gateReasons?: string[]
  integrationOutcome?: string
  usage?: {
    startedAgents?: number
    startedCalls: number
    completedCalls: number
    failedCalls: number
    activeCalls: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    totalTokens: number
    freshTokens: number
    knownCostUsd: number | null
    unpricedCalls: number
    unmeteredCalls: number
    tokenCoverage: 'complete' | 'partial'
    stoppedReason?: string
  }
}

export type RunLifecycleEvent =
  | {
      stage: 'quote'
      runId: string
      timestampMs: number
      quote: RunExecutionQuoteObservation
    }
  | {
      stage: 'workspace'
      runId: string
      timestampMs: number
      workspace: RunWorkspaceObservation
    }
  | {
      stage: 'git'
      runId: string
      timestampMs: number
      git: RunGitObservation
    }
  | {
      stage: 'closure'
      runId: string
      timestampMs: number
      closure: RunClosureObservation
    }
