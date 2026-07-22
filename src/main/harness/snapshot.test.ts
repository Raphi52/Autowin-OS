import { describe, expect, it } from 'vitest'
import {
  assertHarnessInvariants,
  composeHarnessSnapshot,
  MAX_HARNESS_EDGES,
  MAX_HARNESS_NODES,
  type HarnessSnapshotInput
} from './snapshot'

function baseInput(overrides: Partial<HarnessSnapshotInput> = {}): HarnessSnapshotInput {
  return {
    generatedAt: '2026-07-19T10:00:00.000Z',
    roleBindings: {
      orchestrator: { provider: 'claude' },
      subagent: { provider: 'claude' },
      judge: { provider: 'claude' },
      scout: { provider: 'codex' }
    },
    providers: ['claude', 'codex'],
    activeModel: { id: 'claude-opus', provider: 'claude' },
    kit: { injected: true, size: 4096 },
    counts: {
      skills: 12,
      tools: 5,
      hooks: 6,
      behaviour: 9,
      conversations: 3,
      sessions: 20,
      trustModels: 2
    },
    hookEvents: ['Stop', 'PreToolUse', 'UserPromptSubmit'],
    behaviourByEngine: { codex: 2, claude: 5, autowin: 2 },
    brains: [
      { id: 'amitel-brain', label: 'Amitel Brain', kind: 'vault', sizeMb: 0, themes: 7 },
      { id: 'rigapplication', label: 'RIG', kind: 'graphify', sizeMb: 4.2, themes: 0 }
    ],
    runs: { total: 4, blocked: 1, open: 0 },
    budget: { spent: 0.1234, budget: null, alert: false },
    pendingAuthority: 0,
    ...overrides
  }
}

describe('composeHarnessSnapshot — contrat & caps', () => {
  it('respects strict caps and reports them honestly', () => {
    const snap = composeHarnessSnapshot(baseInput())
    expect(snap.caps.maxNodes).toBe(MAX_HARNESS_NODES)
    expect(snap.caps.maxEdges).toBe(MAX_HARNESS_EDGES)
    expect(snap.nodes.length).toBeLessThanOrEqual(MAX_HARNESS_NODES)
    expect(snap.edges.length).toBeLessThanOrEqual(MAX_HARNESS_EDGES)
    expect(snap.caps.nodeCount).toBe(snap.nodes.length)
    expect(snap.caps.edgeCount).toBe(snap.edges.length)
    expect(snap.caps.truncated).toBe(false)
  })

  it('exposes exactly one focal model, at the center layer', () => {
    const snap = composeHarnessSnapshot(baseInput())
    const focal = snap.nodes.filter((n) => n.focal)
    expect(focal).toHaveLength(1)
    expect(focal[0].kind).toBe('model')
    expect(focal[0].label).toBe('claude-opus')
    expect(snap.focusModelId).toBe('claude-opus')
  })

  it('every node carries evidence with a source; non-derived nodes cite a ref', () => {
    const snap = composeHarnessSnapshot(baseInput())
    for (const node of snap.nodes) {
      expect(node.evidence.source).toBeTruthy()
      if (node.evidence.source !== 'derived')
        expect(node.evidence.ref.trim().length).toBeGreaterThan(0)
    }
  })

  it('points role persistence to the Autowin OS app-data folder', () => {
    const roles = composeHarnessSnapshot(baseInput()).nodes.find((node) => node.id === 'roles')
    expect(roles?.evidence.ref).toBe('roles.json (%APPDATA%\\autowin-os)')
  })

  it('all edges reference existing nodes and use allowed verbs', () => {
    const snap = composeHarnessSnapshot(baseInput())
    const ids = new Set(snap.nodes.map((n) => n.id))
    const verbs = new Set([
      'executes',
      'routes',
      'invokes',
      'injects',
      'reads',
      'persists',
      'observes',
      'gates'
    ])
    for (const edge of snap.edges) {
      expect(ids.has(edge.from)).toBe(true)
      expect(ids.has(edge.to)).toBe(true)
      expect(verbs.has(edge.kind)).toBe(true)
    }
  })
})

describe('composeHarnessSnapshot — honnêteté des statuts', () => {
  it('keeps model and providers at unknown (no probe is run)', () => {
    const snap = composeHarnessSnapshot(baseInput())
    for (const node of snap.nodes.filter((n) => n.kind === 'model' || n.kind === 'provider')) {
      expect(node.state).toBe('unknown')
    }
  })

  it('maps a null inventory count to unknown, an empty one to inactive', () => {
    const snap = composeHarnessSnapshot(
      baseInput({
        counts: {
          skills: null,
          tools: 0,
          hooks: 6,
          behaviour: null,
          conversations: 0,
          sessions: 0,
          trustModels: 0
        }
      })
    )
    expect(snap.nodes.find((n) => n.id === 'skills')?.state).toBe('unknown')
    expect(snap.nodes.find((n) => n.id === 'tools')?.state).toBe('inactive')
    expect(snap.nodes.find((n) => n.id === 'behaviour')?.state).toBe('unknown')
    expect(snap.nodes.find((n) => n.id === 'conversations')?.state).toBe('inactive')
  })

  it('reflects a blocking run as blocked on the gate, and a pending decision as warning', () => {
    const snap = composeHarnessSnapshot(
      baseInput({ runs: { total: 2, blocked: 2, open: 1 }, pendingAuthority: 1 })
    )
    expect(snap.nodes.find((n) => n.id === 'gate')?.state).toBe('blocked')
    expect(snap.nodes.find((n) => n.id === 'authority')?.state).toBe('warning')
    expect(snap.nodes.find((n) => n.id === 'runs')?.state).toBe('warning')
  })

  it('marks the shared brain unknown when the share yields nothing (offline-safe)', () => {
    const snap = composeHarnessSnapshot(baseInput({ brains: [] }))
    expect(snap.nodes.find((n) => n.id === 'brain')?.state).toBe('unknown')
  })
})

describe('composeHarnessSnapshot — Brain lecture seule', () => {
  it('never lets the brain execute: no executes edge touches it, only reads', () => {
    const snap = composeHarnessSnapshot(baseInput())
    const brain = snap.nodes.find((n) => n.kind === 'brain')!
    expect(brain.runtime).toBe('shared-brain')
    const touching = snap.edges.filter((e) => e.from === brain.id || e.to === brain.id)
    expect(touching.length).toBeGreaterThan(0)
    for (const edge of touching) {
      expect(edge.kind).toBe('reads')
      expect(edge.to).toBe(brain.id) // le Brain est toujours la CIBLE d'une lecture
    }
  })
})

describe('composeHarnessSnapshot — redaction par construction', () => {
  it('carries only bounded counts/labels — no file content, command, or long blob', () => {
    const snap = composeHarnessSnapshot(baseInput())
    const json = JSON.stringify(snap)
    // aucune chaîne du payload ne dépasse la borne de texte
    const longest = Math.max(
      ...snap.nodes.flatMap((n) => [
        n.label.length,
        n.roleDesc.length,
        n.observed.length,
        n.notObserved.length,
        n.evidence.ref.length,
        ...n.references.map((r) => r.length)
      ])
    )
    expect(longest).toBeLessThanOrEqual(240)
    // le kit n'expose que présence + taille, jamais son contenu SOUL
    const kit = snap.nodes.find((n) => n.id === 'kit')!
    expect(kit.metrics?.some((m) => m.label === 'Taille')).toBe(true)
    // le mot-clé technique interdit (contenu de commande) n'apparaît pas
    expect(json).not.toContain('#!/')
    expect(json).not.toContain('powershell -File')
  })

  it('truncates over-long incoming text instead of dumping it', () => {
    const snap = composeHarnessSnapshot(
      baseInput({ activeModel: { id: 'x'.repeat(600), provider: 'claude' } })
    )
    const model = snap.nodes.find((n) => n.kind === 'model')!
    expect(model.label.length).toBeLessThanOrEqual(240)
    expect(model.label.endsWith('…')).toBe(true)
  })
})

describe('assertHarnessInvariants', () => {
  it('accepts a well-formed snapshot', () => {
    expect(() => assertHarnessInvariants(composeHarnessSnapshot(baseInput()))).not.toThrow()
  })

  it('rejects an orphan edge', () => {
    const snap = composeHarnessSnapshot(baseInput())
    snap.edges.push({
      id: 'bad',
      from: 'ghost',
      to: 'model',
      kind: 'routes',
      flows: ['chat'],
      level: 'both'
    })
    expect(() => assertHarnessInvariants(snap)).toThrow(/orpheline/)
  })

  it('rejects a brain that would execute', () => {
    const snap = composeHarnessSnapshot(baseInput())
    const brain = snap.nodes.find((n) => n.kind === 'brain')!
    snap.edges.push({
      id: 'bad-exec',
      from: brain.id,
      to: 'model',
      kind: 'executes',
      flows: ['brain'],
      level: 'both'
    })
    expect(() => assertHarnessInvariants(snap)).toThrow(/Brain/)
  })
})
