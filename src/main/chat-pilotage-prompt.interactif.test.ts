import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/** Une capacite que le prompt ne nomme pas reste morte — verifie pour l'interactif sans script. */
describe('contrat de l interactif sans JavaScript', () => {
  it('apprend les cases a cocher, les libelles et les jauges, et rappelle la limite', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('INTERACTIF SANS JAVASCRIPT')
    expect(prompt).toContain('type="checkbox"')
    expect(prompt).toContain('<label for>')
    expect(prompt).toContain('<progress>')
    expect(prompt).toContain('<meter>')
    expect(prompt).toContain(':checked')
    // La limite reste dite : rien ne se saisit et rien ne s'envoie.
    expect(prompt).toMatch(/Aucun autre champ n'est accepte/u)
  })
})
