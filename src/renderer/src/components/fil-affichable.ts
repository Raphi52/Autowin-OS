/**
 * QUEL FIL PEINDRE : le cache d'affichage ou celui du store ?
 *
 * DEFAUT VECU (conv-152, saisie ts=1788413114634 : « la moitié de cette convers s'est effacé
 * j'arrive pas a remonter le fil » ; tour /kaizen 57656364-053f-40e6-bc8e-91efd5b74e39). Le disque
 * portait bien les 41 messages, l'ecran n'en montrait que la fin, et rien ne permettait de remonter.
 *
 * CAUSE : `loadConv` prenait le cache d'affichage des qu'il etait NON VIDE
 * (`cache.length > 0 ? cache : duStore`). Or ce cache peut naitre TRONQUE : quand un tour est lance
 * cote processus principal (reprise apres redemarrage, tache planifiee), la vue l'amorce avec le
 * seul message en cours, et le rattrapage de l'historique est abandonne des qu'un message
 * utilisateur est present. Un cache d'UN message gagnait alors sur un store de QUARANTE.
 *
 * IDENTITE PRESERVEE : quand un fil gagne TEL QUEL, on rend le TABLEAU LUI-MEME, jamais une copie.
 * `setMessages` compare par reference : une copie re-rend le fil, ce re-rendu relance la descente
 * automatique, et la descente OUBLIE le geste du lecteur — la position de lecture n'etait plus
 * memorisee (`ChatView.position-lecture-auto.test.tsx` passe au rouge sur une simple copie).
 *
 * REGLE : un fil est APPEND-ONLY. Si le cache est plus court que le store, ce qui lui manque est en
 * TETE : on repose la tete du store et on garde la queue VIVANTE du cache (le tour en vol, que le
 * store ne connait pas encore). Le fil ne peut donc plus RETRECIR.
 */
export type MessageAffichable = { role: string; done?: boolean; turnId?: string }

/**
 * Les tours deja peints par le fil live : un message persiste du MEME tour en est une copie.
 *
 * conv-1118 (2026-10-23, « j'ai eu 2x le meme bloc ») : un tour lance cote main a fini 25 ms apres
 * son premier evenement. Sa copie persistee etait donc deja CLOSE quand le store a repondu, et
 * le filtre « assistant non clos » la laissait passer : la meme question peinte deux fois, une
 * fois depuis le store, une fois depuis l'amorce. On decide sur l'IDENTITE du tour, pas sur son
 * etat a l'instant de la lecture.
 */
function toursPeints(fil: ReadonlyArray<{ role?: string; turnId?: string }>): Set<string> {
  const tours = new Set<string>()
  for (const message of fil)
    if (message.role === 'assistant' && message.turnId) tours.add(message.turnId)
  return tours
}

function copieDUnTourPeint(
  message: { role?: string; turnId?: string },
  tours: ReadonlySet<string>
): boolean {
  return message.role === 'assistant' && !!message.turnId && tours.has(message.turnId)
}

export function filAffichable<M extends MessageAffichable>(
  cache: M[] | undefined,
  duStore: M[]
): M[] {
  if (!cache || cache.length === 0) return duStore
  if (cache.length >= duStore.length) return cache
  // Queue vivante = a partir du premier message assistant non clos (le tour en vol).
  const debutVivant = cache.findIndex(
    (message) => message.role === 'assistant' && message.done !== true
  )
  if (debutVivant < 0) return duStore
  const queue = cache.slice(debutVivant)
  const tours = toursPeints(queue)
  const tete = [...duStore]
  // Le tour en vol peut AUSSI avoir ete persiste — non clos, ou deja clos (conv-1118) : ne pas le
  // peindre deux fois.
  while (tete.length > 0) {
    const dernier = tete[tete.length - 1]
    if (
      (dernier.role === 'assistant' && dernier.done !== true) ||
      copieDUnTourPeint(dernier, tours)
    )
      tete.pop()
    else break
  }
  return [...tete, ...queue]
}

/**
 * RECOLLE l'historique persiste DEVANT un fil live, sans le coller DEUX FOIS.
 *
 * Meme defaut, autre bout de la chaine (conv-152, saisie ts=1788413114634) : le rattrapage de
 * l'historique, apres un tour lance cote main, se refusait des que le fil live portait UN message
 * utilisateur (`courant.some((m) => m.role === 'user')`). C'est une heuristique, pas une identite :
 * un message utilisateur tape pendant que la lecture du store est en vol suffisait a ABANDONNER
 * l'historique — le fil restait tronque a son dernier tour, sans moyen de remonter.
 *
 * On decide donc sur l'IDENTITE : si le fil live porte deja un des messages persistes, il a deja ete
 * recolle ; sinon on repose l'historique devant lui.
 */
export function completerAvecHistorique<
  M extends { messageId?: string; role?: string; turnId?: string }
>(historique: M[], courant: M[]): M[] {
  if (historique.length === 0) return courant
  const identifiants = new Set(
    courant.map((message) => message.messageId).filter((id): id is string => !!id)
  )
  const dejaRecolle = historique.some(
    (message) => !!message.messageId && identifiants.has(message.messageId)
  )
  if (dejaRecolle) return courant
  // Le tour que le fil live peint deja n'est pas recolle depuis le store (conv-1118) : c'est le
  // fil live qui continue de recevoir ses evenements.
  const tours = toursPeints(courant)
  const tete = tours.size
    ? historique.filter((message) => !copieDUnTourPeint(message, tours))
    : historique
  if (tete.length === 0) return courant
  return [...tete, ...courant]
}
