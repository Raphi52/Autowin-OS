import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from './commands'
import { FORME_FILS, lireBlocFils } from '../shared/lancer-en-fils'

/**
 * UNE CAPACITÉ QUE LE PROMPT NE NOMME PAS RESTE MORTE (même règle que la fence mermaid). La carte
 * « Lancer en N fils » (conv-1147) ne s'affiche que si l'agent écrit un bloc ```aw-fils. Sans ce
 * paragraphe, aucun agent ne l'écrirait jamais, et un message à deux tâches resterait traité en série.
 */
describe('contrat « Lancer en N fils » dans la consigne du chat', () => {
  const prompt = buildChatPilotagePrompt(CATALOG)

  it('apprend la fence, ses champs et quand l’écrire', () => {
    expect(prompt).toContain('```' + FORME_FILS)
    expect(prompt).toMatch(/au moins DEUX tâches d'ACTION indépendantes/u)
    expect(prompt).toContain('"fichiers"')
    // Les cas où il ne faut PAS proposer, sinon la carte découpe des étapes liées.
    expect(prompt).toMatch(/questions seules/u)
    expect(prompt).toMatch(/dépend du résultat/u)
    // Le tour s'arrête sur la carte : aucune tâche n'est commencée avant le clic.
    expect(prompt).toMatch(/ne commence AUCUNE/u)
  })

  /*
   * Essai réel du 2026-10-25 (conv-1147, instance de test) : sans cette phrase, l'agent a LU le
   * fichier joint et recopié dans chaque `demande` son contenu ET son chemin temporaire
   * (`autowin-os-attachments-…`), qui est effacé à la fin de son tour (`providers/claude.ts`,
   * `cleanup`). La branche reçoit pourtant les pièces jointes du message (`pieces-jointes-durables.ts`).
   */
  it('dit que les pièces jointes suivent chaque fil : ni contenu ni chemin recopiés', () => {
    expect(prompt).toMatch(/pièces jointes du message suivent chaque fil/u)
    expect(prompt).toMatch(/ni leur chemin temporaire/u)
  })

  it('l’exemple donné dans la consigne est un bloc que la carte sait lire', () => {
    const exemple = /```aw-fils (\{.*?\})\s*—/su.exec(prompt)?.[1]
    expect(exemple).toBeDefined()
    expect(lireBlocFils(exemple!)).not.toHaveProperty('erreur')
  })

  it('disparaît d’un tour lecture seule, qui ne peut rien lancer', () => {
    const lecture = buildChatPilotagePrompt(CATALOG.filter((c) => c.annotations?.readOnlyHint))
    expect(lecture).not.toContain('```' + FORME_FILS)
  })
})
