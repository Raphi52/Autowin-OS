/**
 * UNE passe de veille a la fois, quel que soit le chemin qui la demande.
 *
 * Deux chemins atteignent la meme passe et ne se voyaient pas. `veille-ipc` portait bien une garde de
 * simultaneite, mais INTERNE : elle ne dedoublonnait que l'IPC contre lui-meme. Le planificateur, lui,
 * appelle la generation directement depuis son `executerPasse`, donc passait a cote. Cliquer
 * « En generer plus » pendant qu'une veille planifiee tournait lancait un SECOND fan-out de scouts
 * sur le meme stock — deux fois le cout, et deux ecritures concurrentes du meme magasin de candidats.
 *
 * La garde est donc REMONTEE ici, en un seul objet donne aux deux chemins : le second appelant
 * REJOINT la passe en cours au lieu d'en ouvrir une. Ce n'est pas un verrou qui refuse, c'est un
 * partage — l'appelant tardif recoit le meme resultat, donc rien n'est perdu cote appelant.
 *
 * Fonction PURE de tout contexte : ni disque, ni reseau, ni horloge. Le rearmement passe par les DEUX
 * issues de la promesse, succes comme echec : une passe qui echoue et ne rearmerait pas condamnerait
 * la veille au silence definitif jusqu'au redemarrage.
 */
export function unePasseALaFois<T>(executer: () => Promise<T>): () => Promise<T> {
  let enCours: Promise<T> | undefined
  return () => {
    if (enCours) return enCours
    // `Promise.resolve().then` et non un appel direct : un `executer` qui jette SYNCHRONEMENT laisserait
    // sinon `enCours` non affecte et l'exception traverserait sans jamais rearmer.
    const passe = Promise.resolve().then(executer)
    enCours = passe
    void passe.then(
      () => {
        if (enCours === passe) enCours = undefined
      },
      () => {
        if (enCours === passe) enCours = undefined
      }
    )
    return passe
  }
}
