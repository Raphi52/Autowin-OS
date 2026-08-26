import { describe, expect, it } from 'vitest'
import { isDeliveredOrchestrationOutcome, orchestrationEnEchec } from './orchestration-outcome'

/**
 * MON ERREUR DE CONCEPTION, trouvée au cycle 2 de l'audit.
 *
 * Pour fermer le défaut 4, j'ai fait rendre `false` à `isDeliveredOrchestrationOutcome` sur un
 * travail retenu. C'était juste POUR L'AFFICHAGE — « livré veut dire arrivé quelque part ». Mais
 * ce prédicat a CINQ appelants, et je n'ai demandé à aucun d'eux s'il voulait ce nouveau sens.
 *
 * `agent-pilot.ts:1739` s'en sert pour la comptabilité d'ÉCHEC : `deliveryClosed` faux pose
 * `anyActionFailed`, `echecDeLaDerniereIteration` et remplit `commandesEnEchecNonRattrape`, qui
 * arme la seule relance « corriger et poursuivre ». Donc depuis mon correctif, un run VERT dont le
 * travail est délibérément retenu (`publication: 'hold'` — le cas CENTRAL de ce besoin) est compté
 * comme un échec, et l'agent est relancé pour réparer ce qui n'a jamais cassé.
 *
 * Les deux questions sont distinctes et doivent le rester :
 *   « le travail est-il arrivé quelque part ? »  → `isDeliveredOrchestrationOutcome` (affichage)
 *   « l'orchestration a-t-elle échoué ? »        → `orchestrationEnEchec` (comptabilité)
 *
 * Un travail vert mis de côté exprès répond NON aux deux.
 */

const vertRetenu = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  retainedWorkspace: { runId: 'run-x', path: '/w/run-x', files: ['src/a.ts'] }
}

describe('un travail vert mis de côté exprès n’est pas un échec', () => {
  it('n’est PAS livré (l’affichage ne doit pas dire « terminé »)', () => {
    expect(isDeliveredOrchestrationOutcome(vertRetenu)).toBe(false)
  })

  it('n’est PAS en échec non plus (la comptabilité ne doit pas armer de relance)', () => {
    expect(orchestrationEnEchec(vertRetenu)).toBe(false)
  })

  it('un vrai échec reste un échec', () => {
    expect(orchestrationEnEchec({ gateBlocked: true, status: 'failed' })).toBe(true)
    expect(orchestrationEnEchec({ status: 'succeeded', valid: false })).toBe(true)
    expect(orchestrationEnEchec({})).toBe(true)
  })

  it('une livraison réelle n’est pas en échec', () => {
    const { retainedWorkspace: _r, ...livre } = vertRetenu
    void _r
    expect(orchestrationEnEchec(livre)).toBe(false)
  })
})
