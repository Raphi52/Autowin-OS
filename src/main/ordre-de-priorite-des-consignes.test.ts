import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION } from './response-style'

/**
 * ORDRE DE PRIORITE DES CONSIGNES (2026-09-12).
 *
 * Trois textes sont injectes dans le MEME prompt systeme du chat : la CONSTITUTION, le prompt de
 * PILOTAGE et le PROFIL de reponse. Chacun revendiquait la primaute de son cote — « Cette regle
 * PRIME sur la constitution » (pilotage) et « Une consigne de format strict est prioritaire »
 * (profil, deux fois) — sans qu aucun ne donne l ordre GLOBAL. Deux revendications qui se
 * croisaient n avaient donc aucun departage, et l arbitrage retombait sur le modele.
 *
 * L ordre est desormais ECRIT une seule fois, en tete du prompt de pilotage, et les blocs
 * concernes y RENVOIENT au lieu de se declarer prioritaires.
 */
describe('ordre de priorite des consignes injectees', () => {
  const prompt = buildChatPilotagePrompt([])

  it('ecrit les quatre rangs en tete du prompt de pilotage', () => {
    expect(prompt).toContain('ORDRE DE PRIORITÉ DE TES CONSIGNES')
    expect(prompt).toContain('(1) la CONSTITUTION')
    expect(prompt).toContain('(2) CE prompt de pilotage')
    expect(prompt).toContain('(3) la CONSIGNE de format de ta tâche')
    expect(prompt).toContain('(4) le PROFIL de réponse')
    expect(prompt).toContain('applique la plus RESTRICTIVE')
  })

  it('place cet ordre AVANT les regles qu il arbitre', () => {
    expect(prompt.indexOf('ORDRE DE PRIORITÉ DE TES CONSIGNES')).toBeLessThan(
      prompt.indexOf('RÈGLE PREMIÈRE — RÉPONDS TOI-MÊME')
    )
  })

  it('ne laisse subsister aucune revendication de primaute concurrente', () => {
    expect(prompt).not.toContain('PRIME sur la constitution')
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).not.toContain(
      'Une consigne de format strict est prioritaire'
    )
  })

  it('nomme la REGLE PREMIERE comme la seule exception, et la relie a l ordre', () => {
    expect(prompt).toContain("EXCEPTION nommée par l'ordre de priorité en tête de ce prompt")
    expect(prompt).toContain('UNE exception nommée : la RÈGLE PREMIÈRE')
  })

  it('interdit que la priorite serve a taire une preuve', () => {
    expect(prompt).toContain('la priorité règle la FORME, jamais la vérité de ce que tu rends')
  })
})
