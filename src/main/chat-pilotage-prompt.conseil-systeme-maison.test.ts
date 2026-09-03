import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * Kaizen conv-151, saisie ts=1788375124082 (« kaizen t'avais tout ce qu'il fallait pour reflechir
 * dans le brain ») : conseil d'architecture detaille sur RIG rendu sans AUCUN brain_query. La regle
 * « POUR RELIRE » ne couvrait que les questions sur un acquis, pas les demandes de conseil.
 * Entree qui doit faire rougir : la suppression du paragraphe, ou l'exigence ramenee a « apres ».
 */
describe('conseil sur un systeme maison', () => {
  const prompt = buildChatPilotagePrompt([])

  it('exige un brain_query AVANT d’écrire le conseil', () => {
    expect(prompt).toMatch(/AVANT DE CONSEILLER SUR UN SYSTÈME MAISON/)
    expect(prompt).toMatch(/AVANT d'écrire le conseil/)
    expect(prompt).toMatch(/brain_query/)
  })

  it('ne laisse pas une panne du Brain servir d’excuse', () => {
    expect(prompt).toMatch(/autorisation à répondre quand même/)
  })
})
