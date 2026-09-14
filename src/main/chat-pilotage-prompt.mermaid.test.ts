import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * UNE CAPACITE QUE LE PROMPT NE NOMME PAS RESTE MORTE. Le rendu de la fence ```mermaid a ete
 * branche dans le chat le 2026-09-13 ; sans ce paragraphe, aucun orchestrateur ne l'emettrait
 * jamais et le code de rendu ne servirait a rien.
 */
describe('contrat des diagrammes dans le chat', () => {
  it('apprend la fence mermaid, ses usages et son repli, sans effacer html-render', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toContain('```mermaid')
    expect(prompt).toContain('RENDU en diagramme')
    expect(prompt).toContain('flowchart')
    expect(prompt).toContain('sequenceDiagram')
    // Le repli est annonce : une syntaxe fausse n'est pas rattrapee, elle retombe sur le texte.
    expect(prompt).toMatch(/syntaxe invalide retombe/u)
    // Les deux formats coexistent : mise en page riche d'un cote, relations de l'autre.
    expect(prompt).toContain('```html-render')
    expect(prompt).toContain('pour les schemas de relations')
  })

  // kaizen conv-526, tour c7710deb-b58c-4732-90e6-6d0d7903a5e6 (saisie ts 1789378608553) :
  // « pourquoi RIG reste invisible et Studio clignote » a recu deux listes a puces ; l'utilisateur
  // voulait un schema. Une EXPLICATION de mecanisme comparant deux chemins n'etait pas un declencheur.
  it('declenche un schema pour expliquer un mecanisme ou comparer deux chemins', () => {
    const prompt = buildChatPilotagePrompt([])
    expect(prompt).toMatch(/EXPLIQUES un mecanisme/u)
    expect(prompt).toMatch(/deux chemins/u)
  })
})
