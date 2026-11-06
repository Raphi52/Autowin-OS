import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * PÉRIMÈTRE D'ÉCRITURE DU REPLI `edit_file` — garde contre une auto-limitation MESURÉE.
 *
 * Le périmètre de LECTURE a quitté la consigne (revue règle par règle, 2026-11-06) : Read, Grep et
 * Glob lisent un chemin absolu de fait, aucune trace du défaut depuis le 16/10, et une conclusion
 * négative sans essai relève du réflexe 8 de la constitution. Le même retrait vaut pour l'écriture
 * par `Edit` et `Write`. Reste le repli SANS outils directs, où `edit_file` a des bornes que seule
 * cette consigne nomme.
 */
describe('périmètre d’écriture du repli edit_file', () => {
  // Sans outils directs : le texte `<cmd>` est le seul chemin du modèle.
  const prompt = buildChatPilotagePrompt([])

  /*
   * ECRITURE — mesure (2026-09-02). La consigne ne couvrait que la lecture, et l'agent a
   * presente le refus « chemin hors du workspace » comme voulu : « l'asymetrie est volontaire — lire
   * partout, ecrire seulement chez soi ». Il rendait un patch a coller a la main apres 4 tentatives.
   */
  it('autorise explicitement l’ECRITURE par chemin ABSOLU dans un autre depot', () => {
    expect(prompt).toContain("PÉRIMÈTRE D'ÉCRITURE")
    expect(prompt).toMatch(/chemin ABSOLU dans un AUTRE dépôt/u)
    // Ce qui reste ferme doit etre NOMME, sinon l'agent re-devine ses propres limites.
    expect(prompt).toMatch(/racines système/u)
    // Et l'agent doit DIRE que la compilation et le commit restent chez l'utilisateur.
    expect(prompt).toMatch(/la compilation et le commit restent à l'utilisateur/u)
  })

  it('interdit de s’auto-interdire l’ecriture sans avoir TENTE l’edition', () => {
    expect(prompt).toMatch(/sans avoir TENTÉ l'édition/u)
  })
})
