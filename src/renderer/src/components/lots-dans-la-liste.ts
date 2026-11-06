import { langueCourante } from '../langue'
import { traduireChatFilsEtLots } from '../textes-ecrans/chat-fils-et-lots'
import { deriveConversationState, type ConversationState } from './chat-view-model'
import type { Conv } from './chat-view-types'

/**
 * CE QUE LA LISTE DE GAUCHE FAIT DES FILS DE LOT (2026-10-31).
 *
 * « Les conv de lot ne les affiche pas dans cette liste, on y accède que par les onglets » : un plan
 * de 8 lots ajoutait 8 lignes sous son chef, alors que les onglets de la super conv y mènent déjà.
 * Retirer ces lignes retire aussi ce qu'elles disaient, et ce module le préserve : le moyen
 * d'atteindre un lot sans onglet, et l'état d'un lot, reporté sur son chef et sur son onglet.
 */

/**
 * Pur : les fils de lot que la liste n'affiche pas — tous ceux dont le chef existe encore. Le bloc
 * du chef mène au plan qu'il montre, et (« masque aussi les lots des anciens plans
 * d'un même chef, et rends-les accessibles depuis le bloc de la conv chef ») aux anciens plans aussi
 * (`PlansPrecedents`). Seul un lot dont le chef n'existe plus garde sa ligne : plus rien d'autre ne
 * mènerait à lui.
 */
export function lotsSousOnglets(
  liens: ReadonlyMap<string, { chef: string }>,
  fils: ReadonlyMap<string, unknown>
): ReadonlySet<string> {
  const masques = new Set<string>()
  for (const [fil, lien] of liens) if (fils.has(lien.chef)) masques.add(fil)
  return masques
}

/** Ce qu'une ligne de la liste doit afficher pour un fil. `questionDUnLot` : voir `etatDuChef`. */
export function etatDuFil(
  c: Conv,
  occupe: boolean,
  nonVue: boolean,
  questionDUnLot = false
): ConversationState {
  // Une question passe devant le spinner : un lot qui tourne n'a pas besoin de toi, celui-ci si.
  if (questionDUnLot)
    return {
      ...deriveConversationState({ busy: false, messageCount: 1, asksUser: true }),
      detail: traduireChatFilsEtLots('superConv.question.detail', langueCourante())
    }
  return deriveConversationState({
    busy: occupe,
    messageCount: c.messageCount ?? c.messages?.length ?? 0,
    lastMessageRole:
      c.lastMessageRole ??
      // Même règle que la projection du store : une consigne écrite pendant un
      // tour (`orientation`) ne porte pas d'attente de réponse.
      [...(c.messages ?? [])].reverse().find((m) => m.orientation !== true)?.role,
    lastAssistantStatus: c.lastAssistantStatus,
    asksUser: c.lastAssistantAsksUser === true,
    streamingTurn: c.hasStreamingTurn === true,
    // La conversation OUVERTE est lue par definition : elle ne doit jamais
    // s'afficher « non lue » sous les yeux de celui qui la regarde.
    unseen: nonVue
  })
}

export interface ActiviteDesLots {
  /** Les chefs dont un lot tourne : leur spinner reste allumé. */
  chefsActifs: ReadonlySet<string>
  /** Les chefs dont un lot attend ta réponse. */
  chefsEnQuestion: ReadonlySet<string>
  /** Les fils de lot qui attendent ta réponse : leur onglet le montre. */
  lotsEnQuestion: ReadonlySet<string>
}

/**
 * Pur : l'état des lots, reporté sur leur chef (« le spinner de la conv chef doit pas
 * s'arrêter quand y a des sous-agents qui tournent sous ses ordres », puis « quand une conv de lot a
 * une question ça doit mettre la bonne anim sur la conv chef et l'onglet »). Le chef n'a pas de tour
 * à lui pendant que ses lots travaillent : sans ce report, la liste montrerait un chantier en cours
 * comme à l'arrêt, et une question comme un chantier en cours.
 * Passe par `etatDuFil`, la règle de la ligne d'un fil : un lot compte exactement quand sa propre
 * ligne aurait montré ce spinner ou cette question.
 */
export function activiteDesLots(
  convs: readonly Conv[],
  liens: ReadonlyMap<string, { chef: string }>,
  occupes: ReadonlySet<string>
): ActiviteDesLots {
  const chefsActifs = new Set<string>()
  const chefsEnQuestion = new Set<string>()
  const lotsEnQuestion = new Set<string>()
  for (const c of convs) {
    const chef = liens.get(c.id)?.chef
    if (!chef) continue
    const etat = etatDuFil(c, occupes.has(c.id), false).key
    if (etat === 'running') chefsActifs.add(chef)
    if (etat === 'asking') {
      chefsEnQuestion.add(chef)
      lotsEnQuestion.add(c.id)
    }
  }
  return { chefsActifs, chefsEnQuestion, lotsEnQuestion }
}
