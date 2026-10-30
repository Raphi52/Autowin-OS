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
   * saisie 1793364618896 de conv-1322 (hauteur des schémas, puis fondu entre vues) : les deux dans
   * un seul tour de 33 minutes et 4,48 $, la 2 corrigée, la 1 bloquée par une réservation de
   * conv-1317. Déposer un plan ne demande aucun clic (conv-1171) : le refus de la carte ne s'y
   * oppose pas.
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : renvoyer de nouveau ces tâches à la carte des fils.
   */
  it('lance en plan des tâches indépendantes, sans passer par la carte', () => {
    expect(prompt).not.toMatch(/\(c'est la carte des fils\)/u)
    expect(prompt).toMatch(/lance-les en parallèle avec `plan_de_lots`/u)
    // Le geste déjà localisé reste dans le fil : chaque lot coûte un tour.
    expect(prompt).toMatch(/dont tu connais déjà le fichier et la ligne/u)
  })

  /*
   * fix-ok: conv-1332 — LA PREUVE ÉTAIT DU MAUVAIS CÔTÉ (reprise du 2026-10-30). La première version gardait
   * la série par défaut et demandait « indépendantes, fichiers séparés, chacune un tour entier ». Les
   * deux dernières conditions ne se savent pas avant d'avoir travaillé : sondé sur la saisie
   * 1793364618896, le modèle voit que les tâches ne se croisent pas, classe la 1 en petite correction
   * et reste ici : 0 plan sur 3.
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : refaire dépendre le découpage d'une durée estimée.
   */
  it('décide sur ce que dit le message, jamais sur une durée devinée', () => {
    expect(prompt).not.toMatch(/occuperait un tour entier/u)
    expect(prompt).not.toMatch(/petites tâches qui tiennent dans ce tour/u)
    // Aucune mesure n'établit qu'« une tâche qui paraît petite peut prendre 30 minutes » : le tour
    // cité (3ac2be2e, conv-1322) a passé ces 33 minutes sur les DEUX tâches, et sa petite tâche était
    // bien petite. Une consigne ne donne pas pour raison un fait que personne n'a mesuré.
    expect(prompt).not.toMatch(/paraît petite/u)
    expect(prompt).toMatch(/leur durée n'entre pas dans ce choix/u)
    expect(prompt).toMatch(/aucune n'a besoin du résultat d'une autre/u)
    expect(prompt).toMatch(/lance-les en parallèle avec `plan_de_lots`[^.]*par défaut/iu)
  })

  // Le découpage ne doit pas devenir systématique : des étapes liées restent dans le fil.
  it('garde dans ce tour les étapes liées et le même sujet', () => {
    expect(prompt).toMatch(/ou qu'elles visent le même écran ou le même sujet/u)
  })

  it('disparaît d’un tour lecture seule, et d’un catalogue sans l’outil', () => {
    const lecture = buildChatPilotagePrompt(CATALOG.filter((c) => c.annotations?.readOnlyHint))
    expect(lecture).not.toMatch(/LANCE UN PLAN DE LOTS/u)
    const sansOutil = buildChatPilotagePrompt(CATALOG.filter((c) => c.name !== 'plan_de_lots'))
    expect(sansOutil).not.toMatch(/LANCE UN PLAN DE LOTS/u)
  })
})
