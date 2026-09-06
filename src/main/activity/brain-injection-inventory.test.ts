import { describe, expect, it } from 'vitest'
import { buildBrainInjectionInventory, pointDeTrace } from './brain-injection-inventory'
import { BRAIN_INJECTION_POINTS } from './brain-injection-points'
import type { BrainTrace } from './brain-trace-spool'

function trace(partial: Partial<BrainTrace>): BrainTrace {
  return {
    timestamp: '2026-08-31T10:00:00.000Z',
    conversationId: 'conv-1',
    query: 'q',
    injectedChars: 0,
    ...partial
  }
}

describe('inventaire des appels Brain', () => {
  it('liste TOUS les points du registre, même ceux jamais appelés', () => {
    const inventaire = buildBrainInjectionInventory([], 'conv-1')
    expect(inventaire.points.map((p) => p.id)).toEqual(BRAIN_INJECTION_POINTS.map((p) => p.id))
    expect(inventaire.points.every((p) => p.appelsTotal === 0)).toBe(true)
    expect(inventaire.pointsJamaisAppeles.length).toBeGreaterThan(0)
  })

  it('compte les appels par point et isole la conversation regardée', () => {
    const inventaire = buildBrainInjectionInventory(
      [
        trace({ point: 'orchestration-task-rag', kind: 'automatic', injectedChars: 100 }),
        trace({
          point: 'orchestration-empreinte-depot',
          kind: 'empreinte',
          injectedChars: 40,
          timestamp: '2026-08-31T11:00:00.000Z'
        }),
        trace({
          point: 'orchestration-task-rag',
          kind: 'automatic',
          conversationId: 'conv-2',
          injectedChars: 9
        }),
        trace({ point: 'ui-brain-search', kind: 'recherche', conversationId: 'ui:brain-search' })
      ],
      'conv-1'
    )
    const rag = inventaire.points.find((p) => p.id === 'orchestration-task-rag')!
    expect(rag.appelsTotal).toBe(2)
    expect(rag.appelsConversation).toBe(1)
    expect(rag.caracteresConversation).toBe(100)
    const empreinte = inventaire.points.find((p) => p.id === 'orchestration-empreinte-depot')!
    expect(empreinte.appelsConversation).toBe(1)
    expect(empreinte.dernierAppel).toBe('2026-08-31T11:00:00.000Z')
    const ui = inventaire.points.find((p) => p.id === 'ui-brain-search')!
    expect(ui.appelsTotal).toBe(1)
    expect(ui.appelsConversation).toBe(0)
    expect(inventaire.totalTraces).toBe(4)
  })

  it('rattache une trace historique par son kind quand il est sans ambiguïté', () => {
    expect(pointDeTrace({ kind: 'automatic' })).toBe('orchestration-task-rag')
    expect(pointDeTrace({ kind: 'query' })).toBe('command-brain-query')
    expect(pointDeTrace({})).toBe('orchestration-task-rag')
  })

  it('ne devine PAS un point quand le kind en désigne plusieurs', () => {
    expect(pointDeTrace({ kind: 'depot' })).toBeUndefined()
    const inventaire = buildBrainInjectionInventory([trace({ kind: 'depot' })], 'conv-1')
    expect(inventaire.tracesNonRattachees).toBe(1)
  })

  it('ne rattache pas une trace dont le point est inconnu du registre', () => {
    expect(pointDeTrace({ point: 'point-fantome', kind: 'automatic' })).toBeUndefined()
  })
})
