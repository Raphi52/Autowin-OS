import { describe, expect, it } from 'vitest'
import { REGLES_ECRAN_UTILISATEUR } from './chat-pilotage-prompt'

/**
 * PROUVER UNE INTERFACE SUR LE CODE EN COURS (2026-09-26, conv-863).
 *
 * L'agent du chat a capture le panneau Détails en fenêtre cachée pour prouver le retrait d'un
 * bouton : `ok: true`, mais la capture montrait encore le bouton. L'instance cachée lançait le
 * binaire EMPAQUETÉ, pas le code modifié. `ui-capture.mjs --code-dev` lance le code en cours ; la
 * consigne servie à chaque tour doit le dire au moment où l'agent choisit sa commande de preuve.
 */
describe('consigne de pilotage : capture du code en cours', () => {
  it('nomme --code-dev à côté de ui-capture.mjs', () => {
    expect(REGLES_ECRAN_UTILISATEUR).toContain('node scripts/ui-capture.mjs')
    expect(REGLES_ECRAN_UTILISATEUR).toContain('--code-dev')
  })

  it('dit pourquoi : sans l’option, la capture montre l’application empaquetée', () => {
    expect(REGLES_ECRAN_UTILISATEUR).toMatch(/sans lui, la capture montre l'application EMPAQUETEE/)
    expect(REGLES_ECRAN_UTILISATEUR).toContain('interfaceCapturee')
  })
})
