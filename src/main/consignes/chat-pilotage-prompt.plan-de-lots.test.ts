import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'
import { CATALOG } from '../commands/commands'
import {
  creerPlan,
  lirePlanDeLots,
  marquerLance,
  noterDecision,
  promptDuLot
} from '../../shared/plan-de-lots'

/**
 * UNE CAPACITÉ QUE LE PROMPT NE NOMME PAS RESTE MORTE (2026-10-27) : `plan_de_lots`
 * existait, mais aucune ligne de la consigne ne disait QUAND le proposer — un plan ne naissait que
 * sur demande explicite de l'utilisateur.
 */
describe('règle « tâche longue → plan de lots » dans la consigne du chat', () => {
  const prompt = buildChatPilotagePrompt(CATALOG)

  // Déposer lance le plan, sans clic — la consigne doit le dire à l'agent.
  it('dit quand lancer un plan, et que déposer le lance sans clic', () => {
    expect(CATALOG.some((c) => c.name === 'plan_de_lots')).toBe(true)
    expect(prompt).toMatch(/UNE TÂCHE LONGUE → LANCE UN PLAN DE LOTS/u)
    expect(prompt).toMatch(/au moins TROIS parties sur des fichiers séparés/u)
    // « Déposer part sans clic » est le mode d'emploi de l'outil : il vit dans sa description,
    // recopiée dans la liste texte (`prompt`) et servie telle quelle en outil direct.
    const outil = CATALOG.find((c) => c.name === 'plan_de_lots')!
    expect(outil.description).toMatch(/Le plan PART AUSSITÔT déposé, sans clic de l'utilisateur/u)
    expect(prompt).toContain(outil.description)
    expect(prompt).not.toMatch(/Lancer le plan/u)
  })

  it('la distingue de la règle première', () => {
    expect(prompt).toMatch(/une question ou une analyse \(RÈGLE PREMIÈRE\)/u)
  })

  /*
   * L'IMPASSE DES TÂCHES INDÉPENDANTES (2026-10-30). Cette consigne les
   * renvoyait à la carte des fils, que `CONSIGNE_LANCER_EN_FILS` interdit sauf
   * demande explicite : deux tâches indépendantes partaient donc toujours en série. Mesuré sur la
   * saisie 1793364618896 (hauteur des schémas, puis fondu entre vues) : les deux dans
   * un seul tour de 33 minutes et 4,48 $, la 2 corrigée, la 1 bloquée par une réservation.
   * Déposer un plan ne demande aucun clic : le refus de la carte ne s'y
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
   * fix-ok: LA PREUVE ÉTAIT DU MAUVAIS CÔTÉ (reprise du 2026-10-30). La première version gardait
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
    // cité (3ac2be2e) a passé ces 33 minutes sur les DEUX tâches, et sa petite tâche était
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

  /*
   * CE QUE REÇOIT UN LOT, dit par la description de `plan_de_lots` : elle a été réécrite en « un lot
   * ne sait que sa demande, le contexte et les décisions », ce qui est faux — `promptDuLot` lui envoie
   * aussi la liste des autres lots. Le chef qui la croit écrit un contexte qui redit la fratrie, ou
   * croit un lot aveugle sur les fichiers des autres. Le test lit le VRAI message d'un lot, puis
   * exige que la description nomme chacune de ses quatre parts.
   * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : la phrase « Un lot ne sait que sa demande, le « contexte »
   * commun et les décisions notées », ou toute description qui omet l'une des quatre parts.
   */
  it('la description dit ce que reçoit vraiment chaque lot', () => {
    const lu = lirePlanDeLots({
      titre: 'Traduction',
      contexte:
        'Traduire les écrans en anglais. Décidé : clés i18n en kebab-case, un fichier par écran, rien en dur.',
      lots: [1, 2].map((n) => ({
        titre: `Lot ${n}`,
        demande: `/build traduis l'écran ${n}`,
        fichiers: [`src/ecran-${n}.tsx`]
      }))
    })
    if (!lu.ok) throw new Error(lu.erreur)
    let plan = creerPlan(lu.plan, { id: 'plan-1', chef: 'conv-1', maintenant: 1000 })
    plan = marquerLance({ ...plan, statut: 'en-cours' }, 1, 'conv-110', 2000)
    const note = noterDecision(plan, 'les clés suivent le nom du fichier', 'chef', 3000)
    if (!note.ok) throw new Error(note.erreur)
    const message = promptDuLot(note.plan, note.plan.lots[1])
    expect(message.startsWith("/build traduis l'écran 2")).toBe(true)
    expect(message).toContain('Contexte commun du plan')
    expect(message).toContain('- les clés suivent le nom du fichier (chef)')
    expect(message).toContain('- lot 1 « Lot 1 » : en cours, fil conv-110')

    const description = CATALOG.find((c) => c.name === 'plan_de_lots')!.description
    expect(description).not.toMatch(/ne sait que/u)
    expect(description).toMatch(
      /Chaque lot reçoit sa demande, le « contexte », les décisions notées et la liste des autres lots/u
    )
  })

  it('disparaît d’un tour lecture seule, et d’un catalogue sans l’outil', () => {
    const lecture = buildChatPilotagePrompt(CATALOG.filter((c) => c.annotations?.readOnlyHint))
    expect(lecture).not.toMatch(/LANCE UN PLAN DE LOTS/u)
    const sansOutil = buildChatPilotagePrompt(CATALOG.filter((c) => c.name !== 'plan_de_lots'))
    expect(sansOutil).not.toMatch(/LANCE UN PLAN DE LOTS/u)
  })
})
