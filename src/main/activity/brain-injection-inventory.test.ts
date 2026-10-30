import { describe, expect, it } from 'vitest'
import {
  NOTE_BRUYANTE_SEUIL,
  POINT_LECTURE,
  POINT_NOTES_PROCHES,
  buildBrainInjectionInventory,
  notesServiesJamaisOuvertes,
  pointDeTrace
} from './brain-injection-inventory'
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
          point: 'command-brain-query',
          kind: 'query',
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
    const requete = inventaire.points.find((p) => p.id === 'command-brain-query')!
    expect(requete.appelsConversation).toBe(1)
    expect(requete.dernierAppel).toBe('2026-08-31T11:00:00.000Z')
    const ui = inventaire.points.find((p) => p.id === 'ui-brain-search')!
    expect(ui.appelsTotal).toBe(1)
    expect(ui.appelsConversation).toBe(0)
    expect(inventaire.totalTraces).toBe(4)
  })

  it('une trace de l’empreinte RETIRÉE ne se rattache plus à aucun point vivant', () => {
    // 335 traces historiques portent `kind: 'empreinte'` : elles restent lisibles, mais le point
    // qui les émettait n'existe plus depuis le 2026-09-27 — les attribuer serait mentir.
    expect(pointDeTrace({ kind: 'empreinte' })).toBeUndefined()
    expect(
      pointDeTrace({ point: 'orchestration-empreinte-depot', kind: 'empreinte' })
    ).toBeUndefined()
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

// conv-1303 (2026-10-30) : notes servies souvent et jamais ouvertes, pour /curate.
describe('notes servies jamais ouvertes', () => {
  const servie = (chemin: string, ts: string, conversationId = 'conv-1'): BrainTrace =>
    trace({
      point: POINT_NOTES_PROCHES,
      kind: 'pousse',
      timestamp: ts,
      conversationId,
      notes: [chemin],
      injectedChars: 40
    })
  const lue = (chemin: string, ts: string): BrainTrace =>
    trace({
      point: POINT_LECTURE,
      kind: 'lecture',
      timestamp: ts,
      notes: [chemin],
      injectedChars: 900
    })
  const fois = (n: number, chemin: string, depuis = 10): BrainTrace[] =>
    Array.from({ length: n }, (_, i) =>
      servie(
        chemin,
        `2026-10-30T${String(depuis + Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}:00.000Z`,
        `conv-${i % 3}`
      )
    )

  it('lit des points qui existent dans le registre', () => {
    const ids = BRAIN_INJECTION_POINTS.map((p) => p.id)
    expect(ids).toContain(POINT_NOTES_PROCHES)
    expect(ids).toContain(POINT_LECTURE)
  })

  it('sans aucune ouverture tracée, ne déclare rien (la mesure n’a pas commencé)', () => {
    expect(notesServiesJamaisOuvertes(fois(30, 'a.md'))).toEqual({ notes: [] })
  })

  it('liste les notes servies au moins au seuil et jamais ouvertes, depuis la 1re ouverture', () => {
    const traces = [
      lue('lue.md', '2026-10-30T09:00:00.000Z'),
      ...fois(NOTE_BRUYANTE_SEUIL, 'bruyante.md'),
      ...fois(NOTE_BRUYANTE_SEUIL + 5, 'lue.md'),
      ...fois(NOTE_BRUYANTE_SEUIL - 1, 'rare.md'),
      // Servie AVANT la première ouverture tracée : ne compte pas.
      ...Array.from({ length: 20 }, () => servie('ancienne.md', '2026-10-29T10:00:00.000Z'))
    ]
    const r = notesServiesJamaisOuvertes(traces)
    expect(r.depuis).toBe('2026-10-30T09:00:00.000Z')
    expect(r.notes).toEqual([{ chemin: 'bruyante.md', servies: NOTE_BRUYANTE_SEUIL, fils: 3 }])
    expect(buildBrainInjectionInventory(traces).notesBruyantes).toEqual(r.notes)
    expect(buildBrainInjectionInventory(traces).mesureOuverturesDepuis).toBe(r.depuis)
  })
})
