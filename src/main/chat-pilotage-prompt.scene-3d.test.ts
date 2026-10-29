import { describe, expect, it } from 'vitest'
import {
  REGLES_VISUELLES,
  buildChatPilotagePrompt,
  tourTouchantAuVisuel
} from './chat-pilotage-prompt'

/**
 * UNE CAPACITE QUE LE PROMPT NE NOMME PAS RESTE MORTE (meme regle que mermaid). Le bloc ```threejs
 * est rendu en scene vivante depuis le 2026-10-16 (conv-299, Bloc3D.tsx) ; sans ce paragraphe, un
 * /draft de planetes retomberait sur des dessins CSS — exactement ce que l'utilisateur refusait.
 *
 * Depuis le 2026-10-28 (conv-1229), le paragraphe ne part qu'aux tours VISUELS (bloc conditionnel
 * REGLES_VISUELLES) : 1 000 caracteres de moins sur tout autre tour. Ce fichier tient les deux bouts :
 * la regle est entiere dans le bloc, et une demande de scene 3D ouvre bien ce bloc.
 */
describe('contrat des scenes 3D dans le chat', () => {
  it('apprend la fence threejs, ses outils deja charges et son isolement', () => {
    expect(REGLES_VISUELLES).toContain('```threejs')
    expect(REGLES_VISUELLES).toMatch(/AUCUN `import`/u)
    expect(REGLES_VISUELLES).toContain('`OrbitControls`')
    expect(REGLES_VISUELLES).toMatch(/SANS reseau/u)
  })

  it('demande de reprendre le vrai code d un rendu existant et de controler avant de montrer', () => {
    expect(REGLES_VISUELLES).toMatch(/REPRENDS son vrai code/u)
    expect(REGLES_VISUELLES).toContain('scripts/scene-3d-apercu.mjs')
  })

  it('ne part plus dans le corps servi a chaque tour', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).not.toContain('SCENES 3D')
    expect(prompt).not.toContain('scene-3d-apercu')
  })

  it('une demande de scene en volume ouvre le bloc visuel', () => {
    for (const message of [
      'montre-moi la planète en 3D',
      'fais une scène three.js du décor',
      'une maquette 3D du fond d accueil',
      'refais la scene de l accueil'
    ]) {
      expect(tourTouchantAuVisuel(message)).toBe(true)
    }
  })
})
