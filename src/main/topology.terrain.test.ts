import { describe, expect, it } from 'vitest'
import {
  assertTopology,
  bindingForModel,
  createDefaultTopology,
  migrateTopologyShape,
  removeSlot,
  resolveTopology,
  setSlot,
  type AgentTopology
} from './topology'
import { TEST_MODEL_CATALOG } from './models.fixture'

describe('topology — panel terrain', () => {
  it('crée et résout un slot Terrain par défaut', () => {
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)

    expect(topology.panels.terrain).toHaveLength(1)
    expect(topology.panels.terrain[0].slotId).toBe('terrain-1')
    expect(resolveTopology(topology, TEST_MODEL_CATALOG).terrain).toMatchObject([
      { slotId: 'terrain-1', target: 'terrain' }
    ])
  })

  it('ajoute, remplace et retire des slots Terrain sans muter la source', () => {
    const base = createDefaultTopology(TEST_MODEL_CATALOG)
    const codex = TEST_MODEL_CATALOG.find((model) => model.provider === 'codex')!
    const added = setSlot(base, 'terrain', bindingForModel('terrain-2', codex), TEST_MODEL_CATALOG)

    expect(added.panels.terrain).toHaveLength(2)
    expect(base.panels.terrain).toHaveLength(1)
    expect(removeSlot(added, 'terrain', 'terrain-2').panels.terrain).toHaveLength(1)
  })

  it('migre un profil existant sans perdre ses panels configurés', () => {
    const current = createDefaultTopology(TEST_MODEL_CATALOG)
    const legacy = {
      ...current,
      panels: {
        scout: current.panels.scout,
        frame: current.panels.frame,
        judge: current.panels.judge
      }
    }

    const migrated = migrateTopologyShape(structuredClone(legacy)) as AgentTopology

    expect(migrated.panels.terrain).toEqual([])
    expect(migrated.panels.scout).toEqual(legacy.panels.scout)
    expect(migrated.panels.frame).toEqual(legacy.panels.frame)
    expect(migrated.panels.judge).toEqual(legacy.panels.judge)
    expect(() => assertTopology(migrated, TEST_MODEL_CATALOG)).not.toThrow()
  })

  it('applique aussi la limite de 16 slots au panel Terrain', () => {
    const topology = createDefaultTopology(TEST_MODEL_CATALOG)
    const oversized = {
      ...topology,
      panels: {
        ...topology.panels,
        terrain: Array.from({ length: 17 }, (_, index) =>
          bindingForModel(`terrain-${index + 1}`, TEST_MODEL_CATALOG[0])
        )
      }
    } as AgentTopology

    expect(() => assertTopology(oversized, TEST_MODEL_CATALOG)).toThrow(/terrain.*16 slots maximum/)
  })
})
