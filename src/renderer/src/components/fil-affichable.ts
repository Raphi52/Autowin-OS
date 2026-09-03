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
export type MessageAffichable = { role: string; done?: boolean }

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
  const tete = [...duStore]
  // Le tour en vol peut AUSSI avoir ete persiste non clos : ne pas le peindre deux fois.
  while (tete.length > 0) {
    const dernier = tete[tete.length - 1]
    if (dernier.role === 'assistant' && dernier.done !== true) tete.pop()
    else break
  }
  return [...tete, ...cache.slice(debutVivant)]
}
