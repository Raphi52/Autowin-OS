/** Contrats partagés de l'activité et de l'état des worktrees. */

export type WorktreeState = 'isolated' | 'working' | 'ready' | 'merged' | 'conflict' | 'blocked'
export type FileChangeKind = 'add' | 'mod' | 'del'

export interface WorktreeRuntimeStatus {
  available: boolean
  workspacePath: string
  repoId?: string
  reason?: 'not-git' | 'identity-unavailable'
}

export type WorktreeConflictDiffResult =
  | { available: true; agentId: string; paths: string[]; diff: string }
  | {
      available: false
      reason:
        | 'invalid-agent'
        | 'not-conflict'
        | 'ownership-unproven'
        | 'invalid-path'
        | 'revision-unavailable'
        | 'read-failed'
    }

export interface WorktreeFileChange {
  path: string
  kind: FileChangeKind
}

/** Activité brute d'un agent sur SA copie isolée (fournie par l'orchestration). */
export interface WorktreeAgentActivity {
  agentId: string
  agentName: string
  role?: string
  state: WorktreeState
  files: WorktreeFileChange[]
  startedAtMs: number
  /** Fin (merge réussi ou conflit détecté) ; absent si l'agent travaille encore. */
  endedAtMs?: number
  /** Noms des autres agents touchant le même fichier (rempli quand state = conflict). */
  conflictWith?: string[]
  /** Fichier en cause du conflit (affiché à l'utilisateur). */
  conflictFile?: string
  /** Pourquoi la copie attend sans être un conflit entre agents. */
  attentionReason?:
    'base-dirty' | 'base-in-progress' | 'merge-failed' | 'post-publish-change' | 'retry-exhausted'
  /** Contexte durable du bureau, affiché par le Hub A2. */
  task?: string
  worktreePath?: string
  /** Faux quand la ref est protégée mais que le dossier doit encore être rematérialisé. */
  worktreeAvailable?: boolean
  workspacePath?: string
  baseBranch?: string
  baseSha?: string
  publishedSha?: string
  verdict?: 'unknown' | 'running' | 'green' | 'red' | 'cancelled' | 'interrupted'
  publication?:
    | 'not-requested'
    | 'pending'
    | 'integrating'
    | 'published'
    | 'held'
    | 'cleanup-pending'
    | 'complete'
    | 'blocked'
  recovered?: boolean
  detail?: string
  retryCount?: number
}

/** Source unique pour décider si un bureau attend une action humaine. */
export function requiresAttention(agent: WorktreeAgentActivity): boolean {
  if (agent.state === 'conflict') return true
  if (
    agent.attentionReason === 'retry-exhausted' ||
    agent.attentionReason === 'post-publish-change'
  ) {
    return true
  }
  return agent.state === 'blocked' && agent.attentionReason !== 'base-in-progress'
}
