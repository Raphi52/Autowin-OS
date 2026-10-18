import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * UNE CAPACITE QUE LE PROMPT NE NOMME PAS RESTE MORTE (meme regle que mermaid). Le bloc ```threejs
 * est rendu en scene vivante depuis le 2026-10-16 (conv-299, Bloc3D.tsx) ; sans ce paragraphe, un
 * /draft de planetes retomberait sur des dessins CSS — exactement ce que l'utilisateur refusait.
 */
describe('contrat des scenes 3D dans le chat', () => {
  it('apprend la fence threejs, ses outils deja charges et son isolement', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('```threejs')
    expect(prompt).toMatch(/AUCUN `import`/u)
    expect(prompt).toContain('`OrbitControls`')
    expect(prompt).toMatch(/SANS reseau/u)
  })

  it('demande de reprendre le vrai code d un rendu existant et de controler avant de montrer', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/REPRENDS son vrai code/u)
    expect(prompt).toContain('scripts/scene-3d-apercu.mjs')
  })
})
