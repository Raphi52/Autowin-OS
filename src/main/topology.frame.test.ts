import { describe, it, expect } from 'vitest'
import {
  assertTopology,
  createDefaultTopology,
  migrateTopologyShape,
  resolveTopology,
  setSlot,
  removeSlot,
  bindingForModel,
  type AgentTopology
} from './topology'
import { DEFAULT_IMPORTED_MODELS } from './models'

describe('topology — bloc frame', () => {
  it('createDefaultTopology inclut un bloc frame par défaut (1 slot)', () => {
    const t = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    expect(t.panels.frame).toHaveLength(1)
    expect(t.panels.frame[0].slotId).toBe('frame-1')
  })

  it('resolveTopology résout aussi le bloc frame', () => {
    const t = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    const resolved = resolveTopology(t, DEFAULT_IMPORTED_MODELS)
    expect(resolved.frame).toHaveLength(1)
    expect(resolved.frame[0].target).toBe('frame')
  })

  it('setSlot/removeSlot fonctionnent sur frame (0..N modèles déposés)', () => {
    const base = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    const codex = DEFAULT_IMPORTED_MODELS.find((m) => m.provider === 'codex')!
    const added = setSlot(base, 'frame', bindingForModel('frame-2', codex), DEFAULT_IMPORTED_MODELS)
    expect(added.panels.frame).toHaveLength(2)
    expect(base.panels.frame).toHaveLength(1) // immuable, source non mutée
    const removed = removeSlot(added, 'frame', 'frame-2')
    expect(removed.panels.frame).toHaveLength(1)
  })
})

describe('topology — migration de forme (rétrocompat)', () => {
  it('backfill frame=[] sur un fichier legacy sans le bloc, sans reset des slots existants', () => {
    // Fichier persisté AVANT l'ajout du bloc frame : pas de panels.frame.
    const legacy = {
      version: 1,
      orchestrator: bindingForModel('orchestrator', DEFAULT_IMPORTED_MODELS[0]),
      subagents: [bindingForModel('subagent-1', DEFAULT_IMPORTED_MODELS[0])],
      panels: {
        scout: [bindingForModel('scout-1', DEFAULT_IMPORTED_MODELS[0])],
        judge: [bindingForModel('judge-1', DEFAULT_IMPORTED_MODELS[0])]
      }
    }
    const migrated = migrateTopologyShape(structuredClone(legacy)) as AgentTopology
    expect(migrated.panels.frame).toEqual([]) // backfill
    expect(migrated.panels.scout).toHaveLength(1) // slots existants préservés
    // et passe la validation sans jeter (donc pas de reset via createDefaultTopology)
    expect(() => assertTopology(migrated, DEFAULT_IMPORTED_MODELS)).not.toThrow()
  })

  it('idempotent : ré-appliquer ne change rien', () => {
    const t = createDefaultTopology(DEFAULT_IMPORTED_MODELS)
    const once = migrateTopologyShape(structuredClone(t)) as AgentTopology
    expect(once.panels.frame).toHaveLength(1) // ne rase pas un frame existant
  })
})
