import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from './commands'

/**
 * UNE CAPACITÉ QUE LE PROMPT NE NOMME PAS RESTE MORTE (conv-1151, 2026-10-27) : `plan_de_lots`
 * existait, mais aucune ligne de la consigne ne disait QUAND le proposer — un plan ne naissait que
 * sur demande explicite de l'utilisateur.
 */
describe('règle « tâche longue → plan de lots » dans la consigne du chat', () => {
  const prompt = buildChatPilotagePrompt(CATALOG)

  // conv-1171 : déposer lance le plan, sans clic — la consigne doit le dire à l'agent.
  it('dit quand lancer un plan, et que déposer le lance sans clic', () => {
    expect(CATALOG.some((c) => c.name === 'plan_de_lots')).toBe(true)
    expect(prompt).toMatch(/UNE TÂCHE LONGUE → LANCE UN PLAN DE LOTS/u)
    expect(prompt).toMatch(/au moins TROIS parties sur des fichiers séparés/u)
    expect(prompt).toMatch(/Déposer LANCE le plan aussitôt, sans clic de l'utilisateur/u)
    expect(prompt).not.toMatch(/Lancer le plan/u)
  })

  it('la distingue de la carte des fils et de la règle première', () => {
    expect(prompt).toMatch(/plusieurs demandes indépendantes de l'utilisateur \(c'est la carte des fils\)/u)
    expect(prompt).toMatch(/une question ou une analyse \(RÈGLE PREMIÈRE\)/u)
  })

  it('disparaît d’un tour lecture seule, et d’un catalogue sans l’outil', () => {
    const lecture = buildChatPilotagePrompt(CATALOG.filter((c) => c.annotations?.readOnlyHint))
    expect(lecture).not.toMatch(/LANCE UN PLAN DE LOTS/u)
    const sansOutil = buildChatPilotagePrompt(CATALOG.filter((c) => c.name !== 'plan_de_lots'))
    expect(sansOutil).not.toMatch(/LANCE UN PLAN DE LOTS/u)
  })
})
