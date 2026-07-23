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

  it('distingue un blocage par changements locaux d’un conflit entre agents', () => {
    const m = buildWorktreeActivity([
      agent({
        agentId: 'b',
        agentName: 'Builder',
        state: 'blocked',
        attentionReason: 'base-dirty',
        files: [{ path: 'os.ts', kind: 'mod' }]
      })
    ])

    expect(m.lanes[0].outcome).toBe('blocked')
    expect(m.needsAttention).toBe(1)
    expect(m.journal[0]).toMatchObject({ kind: 'blocked', attentionReason: 'base-dirty' })
    expect(m.journal[0].message).toContain('changements locaux')
    expect(m.journal[0].message).not.toMatch(/conflit|git|merge/i)
  })

  it('signale une opération déjà en cours sans l’attribuer à un conflit entre agents', () => {
    const m = buildWorktreeActivity([
      agent({
        agentId: 'b',
        agentName: 'Builder',
        state: 'blocked',
        attentionReason: 'base-in-progress',
        files: [{ path: 'a.txt', kind: 'mod' }]
      })
    ])

    expect(m.journal[0]).toMatchObject({ kind: 'blocked', attentionReason: 'base-in-progress' })
    expect(m.journal[0].message).toContain('ta branche est déjà occupée')
    expect(m.journal[0].message).toContain('sans y toucher')
    expect(m.journal[0].message).not.toMatch(/conflit|git|merge/i)
  })

  it('ne prétend pas avoir ajouté du code quand la copie se termine sans changement', () => {
    const m = buildWorktreeActivity([
      agent({ agentName: 'Agent', state: 'merged', files: [] })
    ])
    const withChanges = buildWorktreeActivity([agent({ agentName: 'Agent', state: 'merged' })])

    expect(m.journal[0].message).toContain('aucun changement à ajouter')
    expect(m.journal[0].message).not.toContain('ajouté à ton code')
    expect(withChanges.journal[0].message).toContain('ajouté à ton code')
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
