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

  it('nomme la formule exacte qui avait masque l’auto-limitation', () => {
    // C'est la phrase reellement produite le 07/08 : sans elle, la consigne resterait abstraite et le
    // meme evitement pourrait revenir sous ce libelle.
    expect(prompt).toContain('reste à confirmer sur le code')
  })
})
