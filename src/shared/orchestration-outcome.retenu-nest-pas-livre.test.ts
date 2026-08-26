import { describe, expect, it } from 'vitest'
import {
  formatOrchestrationOutcome,
  isDeliveredOrchestrationOutcome
} from './orchestration-outcome'

/**
 * LE DÉFAUT, trouvé par l'audit du 2026-08-26 et reproduit à l'exécution.
 *
 * `orchestrator.ts:2012` pose `retained = green && requiresIsolatedWorkspace && publication ===
 * 'hold'` : un travail RETENU est donc forcément VERT. Et `orchestrator.ts:2113` exclut `retained`
 * de la mise en gate. Résultat : `status: 'succeeded'`, `valid: true`, `gateBlocked: false` —
 * `isDeliveredOrchestrationOutcome` répond OUI sur un travail qui n'a rejoint AUCUN arbre.
 *
 * Sortie observée avant correction, sur un run vert dont le travail est resté dans la copie isolée :
 *
 *   ✅ Workflow terminé · statut succeeded
 *   ✅ Fait — 1. Le résultat demandé a été produit et validé.
 *
 * C'est le faux vert le plus cher de la chaîne : l'utilisateur lit « terminé » sur du code qui
 * n'existe nulle part chez lui. Le correctif `ce256372` visait ce symptôme mais ne pouvait pas
 * l'atteindre — il vit derrière ce `isDelivered`, et ses quatre tests utilisaient tous
 * `gateBlocked: true`, une branche que ce chemin ne produit jamais.
 *
 * LIVRÉ VEUT DIRE ARRIVÉ QUELQUE PART. Un travail retenu n'est pas livré.
 */

const travailRetenu = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  retainedWorkspace: { runId: 'run-x', path: '/w/run-x', files: ['src/a.ts'] }
}

describe('un travail resté dans la copie isolée n’est pas un travail livré', () => {
  it('n’est PAS déclaré livré', () => {
    expect(isDeliveredOrchestrationOutcome(travailRetenu)).toBe(false)
  })

  it('n’affiche PAS « Workflow terminé »', () => {
    const texte = formatOrchestrationOutcome(true, travailRetenu)
    expect(texte).not.toContain('✅ Workflow terminé')
  })

  it('reste livré quand rien n’a été retenu (le chemin nominal ne bouge pas)', () => {
    const { retainedWorkspace: _retenu, ...vraimentLivre } = travailRetenu
    void _retenu
    expect(isDeliveredOrchestrationOutcome(vraimentLivre)).toBe(true)
    expect(formatOrchestrationOutcome(true, vraimentLivre)).toContain('✅ Workflow terminé')
  })
})
