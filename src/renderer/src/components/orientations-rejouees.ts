import type { DirectiveReceipt, Msg } from './chat-view-types'

/** Une consigne relue du journal, telle que le main la rend. */
export interface OrientationRelue {
  ts: number
  texte: string
  turnId?: string
}

/**
 * REJOUER DANS LE FIL LES CONSIGNES DONNEES PENDANT UN TOUR.
 *
 * Mesure du 2026-09-12 : `saisies-utilisateur.jsonl` porte 101 saisies de voie `orientation` et
 * 1 563 rattachements saisie -> tour. Cote ecran, ces consignes ne vivaient que dans un etat React :
 * changer de conversation ou recharger les effaçait, alors qu'elles portent la correction donnee en
 * cours de route.
 *
 * L'ANCRE N'EST JAMAIS FABRIQUEE. Une consigne ne se pose que sur le message assistant qui porte
 * EXACTEMENT son `turnId`. Sans rattachement, ou si ce tour n'est plus dans le fil affiche, la
 * consigne est ECARTEE plutot que posee au hasard : un recu place au mauvais endroit ferait croire
 * que l'utilisateur a corrige autre chose que ce qu'il a corrige.
 *
 * Le statut rendu est `sent` : ces consignes sont, par construction, deja parties -- elles ont ete
 * ecrites au journal puis rattachees a un tour reel.
 */
export function rejouerOrientations(
  orientations: readonly OrientationRelue[],
  messages: readonly Msg[]
): DirectiveReceipt[] {
  const dernierMessageDuTour = new Map<string, number>()
  messages.forEach((message, index) => {
    if (message.role !== 'assistant' || !message.turnId) return
    dernierMessageDuTour.set(message.turnId, index)
  })
  return orientations.flatMap((orientation) => {
    const texte = orientation.texte?.trim()
    if (!texte || !orientation.turnId) return []
    const afterMessageIndex = dernierMessageDuTour.get(orientation.turnId)
    if (afterMessageIndex === undefined) return []
    return [
      {
        id: orientation.ts,
        text: texte,
        status: 'sent' as const,
        afterMessageIndex,
        // -1 : la consigne se pose a la FIN du message d'ancrage. La position fine dans le flux
        // (`afterPartIndex`) n'est connue qu'en direct ; l'inventer serait un faux.
        afterPartIndex: -1
      }
    ]
  })
}
