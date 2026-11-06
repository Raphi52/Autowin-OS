import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CONCISE_STRUCTURED_RESPONSE_INSTRUCTION, STYLE_TON } from './response-style'
import { CONSTITUTION } from './constitution'

/**
 * ORDRE DE PRIORITE DES CONSIGNES (2026-09-12).
 *
 * Trois textes sont injectes dans le MEME prompt systeme du chat : la CONSTITUTION, le prompt de
 * PILOTAGE et le PROFIL de reponse. Chacun revendiquait la primaute de son cote — « Cette regle
 * PRIME sur la constitution » (pilotage) et « Une consigne de format strict est prioritaire »
 * (profil, deux fois) — sans qu aucun ne donne l ordre GLOBAL.
 *
 * Revue règle par règle (2026-11-06) : le paragraphe des quatre rangs a quitté la consigne du chat.
 * Aucun défaut du modèle n'avait été mesuré, seul un défaut de rédaction ; ce qui servait reste, à sa
 * place : l'exception de la RÈGLE PREMIÈRE est dite par elle-même, et « aucun rang n'autorise à taire
 * une preuve » est la limite honnête de la constitution. Ce fichier garde ce qui protège toujours un
 * comportement : aucune revendication de primauté concurrente ne revient.
 */
describe('ordre de priorite des consignes injectees', () => {
  const prompt = buildChatPilotagePrompt([])

  it('ne laisse subsister aucune revendication de primaute concurrente', () => {
    expect(prompt).not.toContain('PRIME sur la constitution')
    expect(CONCISE_STRUCTURED_RESPONSE_INSTRUCTION).not.toContain(
      'Une consigne de format strict est prioritaire'
    )
  })

  it('la RÈGLE PREMIÈRE dit elle-même qu’elle passe devant le « en doute » de la constitution', () => {
    expect(prompt).toMatch(
      /En doute entre répondre et orchestrer : RÉPONDS[^\n]*passe devant[^\n]*« en doute, traite comme substantiel » de la constitution/u
    )
    expect(prompt).not.toContain('ORDRE DE PRIORITÉ DE TES CONSIGNES')
  })

  it('aucune priorité n’autorise à taire une preuve : la limite honnête, et le ton des étapes', () => {
    expect(CONSTITUTION).toMatch(/Un faux vert résiduel reste visible/u)
    expect(STYLE_TON).toMatch(/Simplifier porte sur les mots, jamais sur la preuve/u)
  })
})
