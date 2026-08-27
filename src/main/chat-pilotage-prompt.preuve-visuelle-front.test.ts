import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * DEFAUT VECU (conv-1450) : l'utilisateur a demande de VOIR la capture qui sert a valider une modif
 * front. Le canal a ete cable (agent-pilot republie les pieces jointes image en artefact), mais
 * RIEN dans le prompt n'obligeait a observer avant de dire « valide » — donc aucune image n'arrivait
 * jamais, canal ou pas. Le tuyau sans l'obligation ne montre rien.
 */
describe('preuve visuelle des modifications front', () => {
  it('impose une capture LUE et MONTREE avant tout verdict sur une modification visible', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('PREUVE VISUELLE FRONT')
    expect(prompt).toContain('desktop_observe')
    expect(prompt).toContain('avant de dire « fait »')
    expect(prompt).toContain('nomme dans ta clôture ce que la capture MONTRE')
  })
})
