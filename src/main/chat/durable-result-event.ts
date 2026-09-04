/**
 * LA RECOPIE DU RESULTAT VERS L'EVENEMENT DURABLE, sortie de la fermeture de `runPilotChat`.
 *
 * Pourquoi elle vit ici : cette recopie se fait CHAMP PAR CHAMP, donc un champ non repris est jete
 * en silence — et c'est exactement ce qui arrive a `retryOf` si on l'oublie. Tant que le code
 * vivait dans une fermeture inaccessible, il ne pouvait etre verifie que par une lecture du texte
 * source : un test qui casse sur un renommage et reste vert sur un vrai debranchement. Extraite,
 * la meme logique s'EXECUTE dans un test.
 *
 * Aucun changement de comportement : le corps est celui de `applyDurableEvent`, les pieces jointes
 * restent filtrees par `guardAttachments` du cote appelant.
 */
import type { ChatTurnEvent } from '../../shared/chat-turn'

type Resultat = Extract<ChatTurnEvent, { kind: 'result' }>

export interface ResultatPilote {
  actionId?: string
  name?: string
  ok?: boolean
  data?: unknown
  /** `actionId` de l'echec que cette action rattrape. */
  retryOf?: string
}

export function evenementResultatDurable(
  pilotEvent: ResultatPilote,
  actionIdParDefaut: string,
  attachments?: Resultat['attachments']
): Resultat {
  return {
    kind: 'result',
    actionId: pilotEvent.actionId ?? actionIdParDefaut,
    name: pilotEvent.name as string,
    ok: pilotEvent.ok,
    data: pilotEvent.data,
    ...(pilotEvent.retryOf ? { retryOf: pilotEvent.retryOf } : {}),
    ...(attachments?.length ? { attachments } : {})
  }
}
