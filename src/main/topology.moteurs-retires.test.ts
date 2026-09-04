import { describe, expect, it } from 'vitest'
import { migrateTopologyShape, type AgentTopology } from './topology'

/**
 * Codex, Kimi et Gemini sont retirés du produit. Une topologie DÉJÀ ENREGISTRÉE peut encore
 * pointer dessus — c'est le cas réel mesuré le 2026-09-04 sur `agent-topology.json` :
 * `panels.terrain[0]` = `codex/gpt-5.6-sol`.
 *
 * Sans migration, la validation au chargement rejette la topologie et RÉINITIALISE toute la
 * configuration de l'utilisateur. La migration doit donc rebrancher le slot sur le moteur vivant
 * de l'orchestrateur, en GARDANT le slot (son rôle et son `slotId`), pas en le supprimant.
 */
describe('topology — migration des moteurs retirés', () => {
  const enregistree = {
    version: 1,
    orchestrator: {
      slotId: 'orchestrator',
      provider: 'claude',
      modelId: 'claude/opus',
      reasoningEffort: 'low'
    },
    subagents: [],
    panels: {
      scout: [],
      frame: [],
      terrain: [
        {
          slotId: 'terrain-1',
          provider: 'codex',
          modelId: 'codex/gpt-5.6-sol',
          reasoningEffort: 'low'
        }
      ],
      judge: []
    }
  }

  it('rebranche sur Claude le slot Terrain resté sur Codex, sans perdre le slot', () => {
    const migrated = migrateTopologyShape(structuredClone(enregistree)) as AgentTopology

    expect(migrated.panels.terrain).toHaveLength(1)
    expect(migrated.panels.terrain[0]).toMatchObject({
      slotId: 'terrain-1',
      provider: 'claude',
      modelId: 'claude/opus'
    })
  })

  it('rebranche aussi Kimi et Gemini, sur tous les panels et les sous-agents', () => {
    const mixte = {
      ...enregistree,
      subagents: [
        { slotId: 'subagent-1', provider: 'kimi', modelId: 'kimi/k2', reasoningEffort: 'low' }
      ],
      panels: {
        ...enregistree.panels,
        scout: [
          {
            slotId: 'scout-1',
            provider: 'gemini',
            modelId: 'gemini/pro',
            reasoningEffort: 'low'
          }
        ]
      }
    }

    const migrated = migrateTopologyShape(structuredClone(mixte)) as AgentTopology

    expect(migrated.subagents[0]).toMatchObject({ slotId: 'subagent-1', provider: 'claude' })
    expect(migrated.panels.scout[0]).toMatchObject({ slotId: 'scout-1', provider: 'claude' })
  })

  it('CONTRÔLE NÉGATIF : ne touche pas un slot déjà sur un moteur vivant', () => {
    const vivante = {
      ...enregistree,
      panels: {
        ...enregistree.panels,
        terrain: [
          {
            slotId: 'terrain-1',
            provider: 'claude',
            modelId: 'claude/sonnet',
            reasoningEffort: 'high'
          }
        ]
      }
    }

    const migrated = migrateTopologyShape(structuredClone(vivante)) as AgentTopology

    expect(migrated.panels.terrain[0]).toEqual(vivante.panels.terrain[0])
  })

  it('est idempotente et ne mute pas la source', () => {
    const source = structuredClone(enregistree)
    const une = migrateTopologyShape(source) as AgentTopology
    const deux = migrateTopologyShape(structuredClone(une)) as AgentTopology

    expect(deux).toEqual(une)
    expect(source.panels.terrain[0].provider).toBe('codex')
  })
})
