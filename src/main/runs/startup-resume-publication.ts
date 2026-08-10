import type { WorktreeAgentActivity } from '../../shared/worktree-activity-model'

const TERMINAL_PUBLICATIONS = new Set<NonNullable<WorktreeAgentActivity['publication']>>([
  'complete',
  'published',
  'cleanup-pending',
  'held'
])

export interface PublishedWorktreeProof {
  publication: 'complete' | 'published' | 'cleanup-pending' | 'held'
  publishedSha?: string
}

/**
 * Preuve durable ecrite par le coordinateur AVANT qu'une publication Git puisse declencher le
 * hot-reload du main. Un checkpoint de phases ne doit jamais l'emporter sur cette frontiere.
 */
export function publishedWorktreeProofForResume(
  runId: string,
  activity: readonly WorktreeAgentActivity[]
): PublishedWorktreeProof | undefined {
  const run = activity.find((candidate) => candidate.agentId === runId)
  if (run?.verdict !== 'green' || !run.publication || !TERMINAL_PUBLICATIONS.has(run.publication)) {
    return undefined
  }
  return {
    publication: run.publication as PublishedWorktreeProof['publication'],
    ...(run.publishedSha ? { publishedSha: run.publishedSha } : {})
  }
}
