import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'

/**
 * RESTAURER AVANT DE RÉÉCRIRE.
 *
 * Défaut mesuré le 2026-09-03 (conv-199, saisie ts=2026-09-03T11:21:12.718Z, tour
 * turnId=32acf315-00e1-4494-ae56-5b49a928e3d4) : « t'as pas été capable de me ressortir du code
 * provenant de commits précédents tu m'as refait les éléments tu peux pas revert? » — sur conv-198
 * et conv-191, l'agent a réimplémenté de mémoire du code qui existait dans l'historique Git.
 * Cause : la consigne BUILD réellement envoyée au modèle ne nommait ni `git show`, ni
 * `git restore`, ni `git revert` comme source d'un code déjà écrit.
 */
describe('consigne BUILD — récupérer un code qui a déjà existé', () => {
  it('nomme les commandes de récupération Git', () => {
    for (const commande of ['git log', 'git show', 'git restore', 'git revert']) {
      expect(PHASE_BRIEFS.build).toContain(commande)
    }
  })

  it('interdit explicitement la réécriture de mémoire', () => {
    expect(PHASE_BRIEFS.build).toMatch(/RÉCUPÈRE-LE.*jamais réécrit de mémoire/)
  })
})
