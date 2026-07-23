import { describe, expect, it } from 'vitest'
import {
  buildWorktreeActivity,
  type WorktreeAgentActivity
} from './worktree-activity-model'

function agent(over: Partial<WorktreeAgentActivity> = {}): WorktreeAgentActivity {
  return {
    agentId: 'a1',
    agentName: 'Scout',
    state: 'merged',
    files: [{ path: 'orchestrator.ts', kind: 'mod' }],
    startedAtMs: 1000,
    endedAtMs: 2000,
    ...over
  }
}

describe('worktree-activity-model', () => {
  it('vide → modèle vide, zéro attention', () => {
    const m = buildWorktreeActivity([])
    expect(m.lanes).toHaveLength(0)
    expect(m.journal).toHaveLength(0)
    expect(m.agentsTotal).toBe(0)
    expect(m.needsAttention).toBe(0)
  })

  it('normalise les offsets de frise entre 0 et 1', () => {
    const m = buildWorktreeActivity([
      agent({ agentId: 'a1', startedAtMs: 1000, endedAtMs: 2000 }),
      agent({ agentId: 'a2', agentName: 'Builder', state: 'working', startedAtMs: 3000, endedAtMs: undefined })
    ], 5000)
    const l1 = m.lanes.find((l) => l.agentId === 'a1')!
    expect(l1.startOffset).toBeCloseTo(0) // t0
    expect(l1.endOffset).toBeCloseTo(0.25) // (2000-1000)/(5000-1000)
    const l2 = m.lanes.find((l) => l.agentId === 'a2')!
    expect(l2.endOffset).toBeNull() // encore ouvert
    expect(l2.outcome).toBe('open')
  })

  it('mappe l’état vers l’outcome de la lane', () => {
    const m = buildWorktreeActivity([
      agent({ agentId: 'm', state: 'merged' }),
      agent({ agentId: 'c', state: 'conflict', conflictWith: ['Builder'], conflictFile: 'os.ts' }),
      agent({ agentId: 'w', state: 'working', endedAtMs: undefined })
    ])
    expect(m.lanes.find((l) => l.agentId === 'm')!.outcome).toBe('merged')
    expect(m.lanes.find((l) => l.agentId === 'c')!.outcome).toBe('conflict')
    expect(m.lanes.find((l) => l.agentId === 'w')!.outcome).toBe('open')
  })

  it('compte les copies en attente (conflits) et le total', () => {
    const m = buildWorktreeActivity([
      agent({ agentId: 'm', state: 'merged' }),
      agent({ agentId: 'c1', state: 'conflict' }),
      agent({ agentId: 'c2', state: 'conflict' })
    ])
    expect(m.agentsTotal).toBe(3)
    expect(m.needsAttention).toBe(2)
  })

  it('produit des messages HUMAINS sans jargon git', () => {
    const m = buildWorktreeActivity([
      agent({ agentId: 'a1', agentName: 'Scout', state: 'isolated', endedAtMs: undefined, startedAtMs: 100 }),
      agent({ agentId: 'a2', agentName: 'Judge', state: 'conflict', conflictWith: ['Builder'], conflictFile: 'os.ts', startedAtMs: 200, endedAtMs: 300 })
    ])
    const all = m.journal.map((j) => j.message).join(' ')
    expect(all).not.toMatch(/HEAD|detached|rebase|merge --|checkout/i)
    expect(all).toContain('Scout a pris une copie')
    const conflict = m.journal.find((j) => j.kind === 'conflict')!
    expect(conflict.message).toContain('Judge et Builder')
    expect(conflict.conflictFile).toBe('os.ts')
  })

  it('trie le journal chronologiquement', () => {
    const m = buildWorktreeActivity([
      agent({ agentId: 'late', startedAtMs: 500, endedAtMs: 900 }),
      agent({ agentId: 'early', startedAtMs: 100, endedAtMs: 200 })
    ])
    expect(m.journal[0].agentId).toBe('early')
    expect(m.journal[1].agentId).toBe('late')
  })
})
