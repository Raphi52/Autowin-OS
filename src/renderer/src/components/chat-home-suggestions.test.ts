import { describe, expect, it } from 'vitest'
import { isBlocked } from '../../../shared/run-blocked'
import { STATIC_SUGGESTIONS, buildHomeSuggestions } from './chat-home-suggestions'

/** Un résumé tel que `parseRun` le produit : statut de `STATUSES` (ou `unknown`) + compte de DoD. */
const run = (subject: string, status: string, dodChecked = 0, dodTotal = 0) => ({
  subject,
  summary: { status, dodTotal, dodChecked }
})

const chips = (runs: ReturnType<typeof run>[]): string[] =>
  buildHomeSuggestions({ runs }).flatMap((g) => g.items.map((i) => i.label))

describe('buildHomeSuggestions', () => {
  it('retombe sur le jeu statique quand l’état est vide', () => {
    const groups = buildHomeSuggestions({})
    expect(groups).toHaveLength(1)
    expect(groups[0].items.map((i) => i.label)).toEqual(STATIC_SUGGESTIONS)
  })

  it('propose de débloquer chaque run bloqué, avec une mention @run exploitable', () => {
    expect(
      chips([
        run('workflow-bench-regression', 'red'),
        run('chatview-reprise-tours', 'open'),
        run('deja-clos', 'green', 2, 2)
      ])
    ).toEqual(['Débloque @run:workflow-bench-regression', 'Débloque @run:chatview-reprise-tours'])
  })

  // conv-861 (2026-09-25) : la liste était coupée à 3 AVANT d'être comptée — 7 runs bloqués, « 3 ».
  it('le sous-titre compte TOUS les runs bloqués, même quand seules 3 chips sont montrées', () => {
    const runs = Array.from({ length: 7 }, (_, i) => run(`bloque-${i}`, 'open'))
    const [groupe] = buildHomeSuggestions({ runs: [run('clos', 'green', 1, 1), ...runs] })
    expect(groupe.title).toBe('Runs bloqués')
    expect(groupe.subtitle).toBe('7')
    expect(groupe.items.map((i) => i.label)).toEqual([
      'Débloque @run:bloque-0',
      'Débloque @run:bloque-1',
      'Débloque @run:bloque-2'
    ])
  })

  it('n’affiche RIEN tant qu’un brouillon est en cours — il ne doit pas être recopié à l’écran', () => {
    expect(
      buildHomeSuggestions({ resumedDraft: 'prompt à restaurer', runs: [run('r1', 'open')] })
    ).toEqual([])
  })
})

/**
 * UNE SEULE RÈGLE DU « BLOQUÉ » (conv-861, 2026-09-25). L'accueil jugeait sur le seul statut, par
 * motif de texte, alors que `get_state` et l'Observatoire appliquent `isBlocked`
 * (src/shared/run-blocked.ts). Les deux listes divergeaient sur trois cas bien réels :
 * un `green` dont une case de DoD reste `- [ ]`, un RUN.md sans statut lisible (`unknown`), et les
 * statuts fossiles `running` / `pending` d'un run abandonné.
 */
describe('les chips « Runs bloqués » suivent la règle unique isBlocked', () => {
  it('vert mais une case de DoD non cochée : bloqué', () => {
    expect(chips([run('vert-incomplet', 'green', 5, 6)])).toEqual(['Débloque @run:vert-incomplet'])
  })

  it('statut illisible (unknown) et fossiles running/pending : bloqués', () => {
    expect(
      chips([run('illisible', 'unknown'), run('fige', 'running'), run('attente', 'pending')])
    ).toEqual(['Débloque @run:illisible', 'Débloque @run:fige', 'Débloque @run:attente'])
  })

  it('clos à DoD complète (green, succeeded, degraded-closed) : aucune chip', () => {
    expect(
      chips([run('a', 'green', 3, 3), run('b', 'succeeded'), run('c', 'degraded-closed', 1, 1)])
    ).toEqual(STATIC_SUGGESTIONS)
  })

  it('même verdict que isBlocked sur tous les statuts connus, DoD complète ou non', () => {
    const statuts = [
      'pending',
      'running',
      'succeeded',
      'failed',
      'open',
      'red',
      'green',
      'degraded-closed',
      'unknown'
    ]
    for (const status of statuts)
      for (const [coches, total] of [
        [0, 0],
        [1, 2],
        [2, 2]
      ]) {
        const r = run(`r-${status}-${coches}-${total}`, status, coches, total)
        expect(
          chips([r]).includes(`Débloque @run:${r.subject}`),
          `${status} ${coches}/${total}`
        ).toBe(isBlocked(r.summary))
      }
  })
})
