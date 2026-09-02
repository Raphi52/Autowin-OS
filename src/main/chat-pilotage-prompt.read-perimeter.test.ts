import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * PERIMETRE DE LECTURE — garde contre une auto-limitation MESUREE, pas supposee.
 *
 * Le 07/08, le chat a refuse d'analyser un ticket : « le depot RIG n'est pas accessible depuis cette
 * session (workspace limite a E:\GIT\Autowin-OS) […] reste a confirmer sur le code ». Le 10/08, le meme
 * chat a lu D:\GIT\RigApplication\greffe_map.txt sans difficulte. L'argv journalise des DEUX tours est
 * identique (`--add-dir E:\GIT\Autowin-OS`, aucun autre dossier) : il n'y avait aucun blocage technique.
 *
 * Le reflexe 10 de la constitution (cloture NEGATIVE : balayer l'atteignable avant « impossible »)
 * existait deja et n'a pas suffi — il est generique. Ce test garde la consigne qui NOMME le cas.
 */
describe('perimetre de lecture du chat', () => {
  const prompt = buildChatPilotagePrompt([])

  it('autorise explicitement la lecture d’un chemin ABSOLU hors du workspace', () => {
    expect(prompt).toContain('PÉRIMÈTRE DE LECTURE')
    expect(prompt).toMatch(/LIRE un chemin ABSOLU hors du workspace/u)
    // Le cas reel etait un AUTRE DISQUE (D: alors que le workspace est sur E:).
    expect(prompt).toContain('autre disque')
  })

  it('interdit de conclure a l’inaccessibilite sans avoir TENTE la lecture', () => {
    expect(prompt).toMatch(/sans avoir TENTÉ la lecture/u)
    // L'exigence de preuve : une erreur citee, pas un verdict d'inaccessibilite.
    expect(prompt).toMatch(/cite l'erreur exacte/u)
  })

  /*
   * ECRITURE — mesure conv-12 (2026-09-02). La consigne ne couvrait que la lecture, et l'agent a
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

  it('nomme la formule exacte qui avait masque l’auto-limitation', () => {
    // C'est la phrase reellement produite le 07/08 : sans elle, la consigne resterait abstraite et le
    // meme evitement pourrait revenir sous ce libelle.
    expect(prompt).toContain('reste à confirmer sur le code')
  })
})
