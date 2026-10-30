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

  it('la distingue de la règle première', () => {
    expect(prompt).toMatch(/une question ou une analyse \(RÈGLE PREMIÈRE\)/u)
  })

  /*
   * L'IMPASSE DES TÂCHES INDÉPENDANTES (kaizen de conv-1332, 2026-10-30). Cette consigne les
   * renvoyait à la carte des fils, que `CONSIGNE_LANCER_EN_FILS` interdit depuis conv-1163 sauf
   * demande explicite : deux tâches indépendantes partaient donc toujours en série. Mesuré sur la
   * saisie 1793348606693 de conv-1306 (une commande, puis six variantes) : tout dans un seul tour de
   * 16 minutes et 5,88 $. Déposer un plan ne demande aucun clic (conv-1171) : le refus de la carte
   * ne s'y oppose pas.
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : renvoyer de nouveau ces tâches à la carte des fils.
   */
  it('lance en plan des tâches indépendantes et longues, sans passer par la carte', () => {
    expect(prompt).not.toMatch(/\(c'est la carte des fils\)/u)
    expect(prompt).toMatch(/PLUSIEURS tâches d'action indépendantes, sur des fichiers séparés/u)
    expect(prompt).toMatch(/lance-les en parallèle avec `plan_de_lots`/u)
    // Le petit travail reste dans le fil : chaque lot coûte un tour.
    expect(prompt).toMatch(/de petites tâches qui tiennent dans ce tour ou qui touchent les mêmes fichiers/u)
  })

  it('disparaît d’un tour lecture seule, et d’un catalogue sans l’outil', () => {
    const lecture = buildChatPilotagePrompt(CATALOG.filter((c) => c.annotations?.readOnlyHint))
    expect(lecture).not.toMatch(/LANCE UN PLAN DE LOTS/u)
    const sansOutil = buildChatPilotagePrompt(CATALOG.filter((c) => c.name !== 'plan_de_lots'))
    expect(sansOutil).not.toMatch(/LANCE UN PLAN DE LOTS/u)
  })
})
