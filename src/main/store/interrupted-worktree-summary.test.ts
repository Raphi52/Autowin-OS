import { describe, expect, it } from 'vitest'
import { summarizeInterruptedWorktrees } from './interrupted-worktree-summary'

describe('summarizeInterruptedWorktrees', () => {
  it('borne le journal de démarrage à trois copies et annonce le reste', () => {
    const lines = summarizeInterruptedWorktrees(
      Array.from({ length: 8 }, (_, index) => ({
        runId: `run-${index + 1}`,
        worktreePath: `C:\\copies\\run-${index + 1}`,
        conversationId: `conv-${index + 1}`
      })),
      3
    )

    expect(lines).toHaveLength(5)
    expect(lines[0]).toBe('[worktrees] 8 copies isolées interrompues conservées')
    expect(lines[1]).toContain('run-1')
    expect(lines[3]).toContain('run-3')
    expect(lines[4]).toBe('[worktrees] … 5 autres copies visibles dans la vue Worktrees')
    expect(lines.join('\n')).not.toContain('run-4')
  })

  it('ne produit aucun bruit sans copie interrompue', () => {
    expect(summarizeInterruptedWorktrees([])).toEqual([])
  })
})
