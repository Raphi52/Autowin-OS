import { describe, expect, it, vi } from 'vitest'

vi.mock('../runs/murs-store', () => ({
  chargerMurs: vi.fn(() => []),
  enregistrerMur: vi.fn()
}))

import type { CommandResult } from '../commands'
import { appelsNatifsDuTour } from './appels-natifs'
import { etatInitialDuTour, type EtatDuTour } from './etat-du-tour'

/**
 * LES DEUX DRAPEAUX QU'AUCUN TEST NE TENAIT (conv-1580, lot 3).
 *
 * Le lot 3 a réinjecté cinq défauts dans `appels-natifs.ts` : trois étaient attrapés, deux non —
 * `anyActionExecuted` levé par un appel direct, et `anyActionFailed` dans la comptabilité. Les
 * tests existants lisent le TEXTE du pilote ; celui-ci exécute le module. Entrées qui le font
 * échouer : la ligne `etat.anyActionExecuted = true` retirée de `executerAppelNatif`, ou
 * `etat.anyActionFailed = true` retirée de `comptabiliserCommande`.
 */
const snapshot = { runs: [] } as unknown as Parameters<typeof etatInitialDuTour>[0]['snapshot']
const nouvelEtat = (): EtatDuTour =>
  etatInitialDuTour({
    resumeSessionId: undefined,
    compteAuDepart: undefined,
    blocsDuTour: [],
    maxIter: 5,
    conversationId: undefined,
    snapshot
  })

const outils = (etat: EtatDuTour, resultat: CommandResult) =>
  appelsNatifsDuTour({
    etat,
    conversationId: undefined,
    provider: 'claude',
    signal: undefined,
    emit: () => undefined,
    execCommandTolerante: async () => resultat
  })

describe('appels directs du modèle — drapeaux du tour (appels-natifs.ts)', () => {
  it.each([
    ['réussi', { ok: true, data: { contenu: 'x' } } as CommandResult],
    ['en échec', { ok: false, error: 'refusé' } as CommandResult]
  ])('un appel direct %s lève anyActionExecuted', async (_cas, resultat) => {
    const etat = nouvelEtat()
    expect(etat.anyActionExecuted).toBe(false)
    await outils(etat, resultat).executerAppelNatif('get_state', {})
    expect(etat.anyActionExecuted).toBe(true)
  })

  it('la comptabilité lève anyActionFailed sur un échec', () => {
    const etat = nouvelEtat()
    const compte = outils(etat, { ok: true }).comptabiliserCommande(
      'edit_file',
      { path: 'a.ts' },
      { ok: false, error: 'old_string introuvable' },
      'a-1'
    )
    expect(compte.reussie).toBe(false)
    expect(etat.anyActionFailed).toBe(true)
  })

  it('la comptabilité laisse anyActionFailed à faux sur une réussite', () => {
    const etat = nouvelEtat()
    const compte = outils(etat, { ok: true }).comptabiliserCommande(
      'edit_file',
      { path: 'a.ts' },
      { ok: true, data: { applied: true } },
      'a-1'
    )
    expect(compte.reussie).toBe(true)
    expect(etat.anyActionFailed).toBe(false)
  })

  it('un appel direct en échec passe par la même comptabilité', async () => {
    const etat = nouvelEtat()
    await outils(etat, { ok: false, error: 'refusé' }).executerAppelNatif('edit_file', {
      path: 'a.ts'
    })
    expect(etat.anyActionFailed).toBe(true)
  })
})
