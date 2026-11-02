import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * Gros chantier (conv-1362, lot conv-1366) : le modèle doit savoir QUAND prendre `Workflow` plutôt
 * que `plan_de_lots` ou `orchestrate`, et qu'il ne le prend jamais de lui-même. Entrée qui doit faire
 * rougir : la suppression du paragraphe, ou la perte de l'échantillon, qui protège le quota.
 */
describe('consigne des gros chantiers', () => {
  const prompt = buildChatPilotagePrompt([])

  it('dit quand prendre l’outil, face à plan_de_lots et orchestrate', () => {
    expect(prompt).toMatch(/GROS CHANTIER → OUTIL `Workflow`/)
    expect(prompt).toMatch(/même geste sur beaucoup d'éléments/)
    expect(prompt).toMatch(/vérification croisée/)
    expect(prompt).toMatch(/migration/)
    expect(prompt).toMatch(/`plan_de_lots` reste/)
    expect(prompt).toMatch(/`orchestrate` reste/)
  })

  it('jamais par défaut : le quota, donc un petit échantillon d’abord', () => {
    expect(prompt).toMatch(/Jamais par défaut/)
    expect(prompt).toMatch(/petit échantillon/)
  })

  it('dit qu’ultracode ne déclenche rien ici', () => {
    expect(prompt).toMatch(/ultracode ne déclenche rien/)
  })

  it('dit quoi faire quand l’outil n’est pas chargé', () => {
    expect(prompt).toMatch(/Lance un workflow/)
  })

  it('reste court', () => {
    const debut = prompt.indexOf('GROS CHANTIER → OUTIL')
    const paragraphe = prompt.slice(debut, prompt.indexOf('\n', debut))
    expect(paragraphe.length).toBeLessThan(1_200)
  })
})
