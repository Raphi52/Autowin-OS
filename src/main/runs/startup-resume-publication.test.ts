import { describe, expect, it } from 'vitest'
import type { WorktreeAgentActivity } from '../../shared/worktree-activity-model'
import { publishedWorktreeProofForResume } from './startup-resume-publication'

function activity(
  publication: WorktreeAgentActivity['publication'],
  verdict: WorktreeAgentActivity['verdict'] = 'green'
): WorktreeAgentActivity {
  return {
    agentId: 'run-published',
    agentName: 'terrain',
    state: 'merged',
    files: [],
    startedAtMs: 1,
    verdict,
    publication,
    publishedSha: 'a'.repeat(40)
  }
}

describe('reprise au demarrage - preuve de publication worktree', () => {
  it.each(['complete', 'published', 'cleanup-pending', 'held'] as const)(
    'interdit de relancer un pipeline deja terminal (%s)',
    (publication) => {
      expect(publishedWorktreeProofForResume('run-published', [activity(publication)])).toEqual({
        publication,
        publishedSha: 'a'.repeat(40)
      })
    }
  )

  it.each(['pending', 'integrating', 'blocked', 'not-requested'] as const)(
    'laisse reprenable un pipeline non publie (%s)',
    (publication) => {
      expect(
        publishedWorktreeProofForResume('run-published', [activity(publication)])
      ).toBeUndefined()
    }
  )

  it('ne croit jamais une publication terminale si le verdict nest pas vert', () => {
    expect(
      publishedWorktreeProofForResume('run-published', [activity('complete', 'interrupted')])
    ).toBeUndefined()
  })
})
