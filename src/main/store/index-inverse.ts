/**
 * QUELLES CONVERSATIONS PEUVENT CONTENIR CE MOT — sans lire le corpus.
 *
 * La recherche parcourait les 1197 conversations a chaque appel, et l'index de voisinage etait
 * DETRUIT a chaque message pour etre reconstruit entierement a la recherche suivante. Mesure : 108 ms
 * synchrones dans le processus principal d'Electron, a chaque tour de chat. Un gel percu, pas un
 * chiffre abstrait.
 *
 * Deporter ce calcul dans un worker aurait DEPLACE le probleme -- et paye 28 Mo de serialisation pour
 * l'y envoyer. Le supprimer demande de ne plus poser la question au corpus entier : un index inverse
 * repond « ces trois conversations, pas les 1194 autres », et se met a jour a l'AJOUT d'un message
 * plutot que d'etre jete.
 *
 * Ce n'est pas un cache de resultats : c'est une pre-selection de CANDIDATS. Le scan fin (score,
 * extraits, revirements) reste identique, il ne porte plus que sur ce qui peut correspondre.
 */

export interface IndexInverse {
  /** Les conversations qui contiennent au moins une des racines, ou undefined si l'index ne sait pas. */
  candidates(racines: readonly string[]): Set<string> | undefined
  /** Enregistre un message : mise a jour INCREMENTALE, aucun parcours du corpus. */
  ajouter(conversationId: string, racines: readonly string[]): void
  /** Oublie une conversation entiere (suppression). */
  retirer(conversationId: string): void
}

/*
 * Les porteurs d'une racine sont des NUMÉROS de conversation dans un tableau trié, plus des ensembles d'ids.
 * Mesure du 13/11 sur le corpus réel (1630 fils) : la forme précédente, un `Set` d'ids par racine plus un
 * `Set` de racines par conversation (pour `retirer`), pesait 108 Mo — un `Set` par racine, alors que la
 * plupart des racines n'ont qu'un ou deux porteurs. `retirer`, rare (le store remet l'index à zéro à la
 * suppression d'un fil), parcourt les racines au lieu de tenir un second index.
 */
export function creerIndexInverse(): IndexInverse {
  /** racine -> numéros des conversations qui la portent, triés, sans doublon. */
  const parRacine = new Map<string, number[]>()
  /** numéro -> id ; un numéro n'est jamais réattribué. */
  const ids: string[] = []
  const numeros = new Map<string, number>()

  /** Place du numéro dans le tableau trié : son rang s'il y est, sinon `-(rang d'insertion) - 1`. */
  const chercher = (porteurs: readonly number[], numero: number): number => {
    let bas = 0
    let haut = porteurs.length - 1
    while (bas <= haut) {
      const milieu = (bas + haut) >>> 1
      const valeur = porteurs[milieu]
      if (valeur === numero) return milieu
      if (valeur < numero) bas = milieu + 1
      else haut = milieu - 1
    }
    return -bas - 1
  }

  return {
    candidates(racines) {
      if (racines.length === 0) return undefined
      const reunion = new Set<string>()
      for (const racine of racines) {
        const porteurs = parRacine.get(racine)
        if (!porteurs) continue
        for (const numero of porteurs) reunion.add(ids[numero])
      }
      return reunion
    },

    ajouter(conversationId, racines) {
      let numero = numeros.get(conversationId)
      if (numero === undefined) {
        numero = ids.length
        ids.push(conversationId)
        numeros.set(conversationId, numero)
      }
      for (const racine of racines) {
        const porteurs = parRacine.get(racine)
        if (!porteurs) {
          parRacine.set(racine, [numero])
          continue
        }
        // Cas courant (construction fil par fil, nouveau message du dernier fil) : en fin de tableau.
        const dernier = porteurs[porteurs.length - 1]
        if (dernier === numero) continue
        if (dernier < numero) {
          porteurs.push(numero)
          continue
        }
        const place = chercher(porteurs, numero)
        if (place < 0) porteurs.splice(-place - 1, 0, numero)
      }
    },

    retirer(conversationId) {
      const numero = numeros.get(conversationId)
      if (numero === undefined) return
      for (const [racine, porteurs] of parRacine) {
        const place = chercher(porteurs, numero)
        if (place < 0) continue
        if (porteurs.length === 1) parRacine.delete(racine)
        else porteurs.splice(place, 1)
      }
    }
  }
}
