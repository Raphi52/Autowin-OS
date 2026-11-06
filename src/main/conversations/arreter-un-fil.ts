/**
 * ARRÊTER UN AUTRE FIL, DEPUIS UN AGENT — le même geste que son bouton « Arrêter ».
 *
 * Constaté le 2026-11-05 : un fil a tourné deux heures dans une boucle de réparation
 * que le contrôle final refusait à chaque essai, pour 402 $. L'agent qui a trouvé la cause n'avait
 * aucun outil pour la couper ; il a dû écrire « clique sur Arrêter » à l'utilisateur pendant que
 * le compteur continuait.
 *
 * Le bouton (`os:pilotChat:cancel`, `ipc/chat.ts`) coupe DEUX choses : le tour de chat du fil et
 * son run de développement (`abortOrchestration`). On fait les deux, dans l'ordre de
 * `arreter-avant-suppression.ts` : le tour EN PREMIER, pour que l'arrêt soit marqué voulu avant que
 * le run coupé ne rende son rouge. Rien n'est supprimé : la copie de travail du run reste.
 */
import type { ActiveChatTurns } from '../chat/active-chat-turns'

/** Borne du motif : il finit dans la trace de l'arrêt, pas dans un rapport. */
export const MOTIF_MAX_ARRET_FIL = 300

export type DependancesArret = {
  /** Le fil existe-t-il ? (`conversationExiste`, câblé depuis index.ts). */
  existe: (conversationId: string) => boolean
  /** Les tours de chat en vol. Absent : seul le run peut être coupé, et on le dit. */
  tours?: Pick<ActiveChatTurns, 'abort'>
  /** Coupe le run du fil : `AppCommandBus.abortOrchestration`. */
  couperLeRun: (conversationId: string, motif: string) => boolean
}

export type ResultatArret = {
  fil: string
  tourCoupe: boolean
  runCoupe: boolean
  motif: string
  detail: string
}

export function arreterUnFil(
  args: Record<string, unknown>,
  appelant: string,
  deps: DependancesArret
): ResultatArret {
  if (!appelant)
    throw new Error(
      "arreter_un_fil : aucun fil d'origine connu — l'outil ne sert qu'aux agents d'un fil de conversation."
    )
  const fil = typeof args.conversationId === 'string' ? args.conversationId.trim() : ''
  if (!fil)
    throw new Error('arreter_un_fil : conversationId absent. Nomme UN fil (ex. « conv-1613 »).')
  if (fil === appelant)
    throw new Error(
      `arreter_un_fil : ${fil} est ton propre fil. Termine ton tour au lieu de le couper.`
    )
  const motifBrut = typeof args.motif === 'string' ? args.motif.trim() : ''
  if (!motifBrut)
    throw new Error(
      'arreter_un_fil : motif absent. Dis en une phrase pourquoi tu arrêtes ce fil : il est écrit dans la trace.'
    )
  if (motifBrut.length > MOTIF_MAX_ARRET_FIL)
    throw new Error(
      `arreter_un_fil : motif de ${motifBrut.length} caractères, la limite est ${MOTIF_MAX_ARRET_FIL}.`
    )
  if (!deps.existe(fil))
    throw new Error(`arreter_un_fil : le fil « ${fil} » est inconnu, archivé ou supprimé.`)

  // Le motif dit QUI a coupé : sans cela, la trace du fil arrêté attribuerait le geste à
  // l'utilisateur de ce fil-là, qui n'a rien cliqué.
  const motif = `arret demande par ${appelant} (arreter_un_fil) : ${motifBrut}`
  const tourCoupe = deps.tours?.abort(fil, motif) ?? false
  const runCoupe = deps.couperLeRun(fil, motif)

  const coupes = [tourCoupe ? 'son tour' : '', runCoupe ? 'son run' : ''].filter(Boolean)
  const detail = coupes.length
    ? `${fil} arrêté : ${coupes.join(' et ')} coupé${coupes.length > 1 ? 's' : ''}. Le travail déjà fait reste dans sa copie de travail.`
    : deps.tours
      ? `Rien ne tournait dans ${fil} : aucun tour ni run en cours. Il était déjà arrêté.`
      : `Aucun run en cours dans ${fil}. Son tour de chat n'a pas pu être vérifié : les tours ne sont pas câblés dans ce processus.`
  return { fil, tourCoupe, runCoupe, motif, detail }
}
