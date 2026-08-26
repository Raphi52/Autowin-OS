import { readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * LA VRAIE USINE A RESIDUS : `git worktree remove` laisse la coquille derriere lui.
 *
 * MESURE le 2026-08-25 dans ce depot. Apres avoir libere deux bureaux avec
 * `git worktree remove --force`, les DOSSIERS etaient toujours la : zero fichier utile, un `.git`
 * orphelin, ~1 Mo piece. C'est tres probablement l'origine des douze coquilles trouvees le meme
 * jour — la purge existante ne les voyait pas, `git worktree prune` non plus (elles ne sont deja
 * plus au registre).
 *
 * ET ELLES NE SONT PAS INOFFENSIVES. Un `git status` lance dans une coquille ne repond pas
 * « vide » : git remonte l'arborescence, trouve le depot PARENT et rapporte SON etat. Les douze
 * coquilles ont ainsi paru porter exactement les memes fichiers modifies — ceux de la session en
 * cours. Cette fausse lecture a ete propagee jusque dans un message de commit avant d'etre
 * rattrapee. Une coquille ne coute donc pas seulement du disque : elle MENT a qui la mesure.
 *
 * LA REGLE, heritee du cadrage : on ne purge QUE ce dont l'absence de valeur est DEMONTREE. Ici la
 * demonstration est directe et ne demande aucun jugement — le dossier ne contient AUCUN fichier
 * hors `.git`. Jamais un critere d'age, jamais une heuristique de nom, jamais « ca ressemble a du
 * jetable ». Un bureau porteur de travail non repris n'est JAMAIS purge par ce chemin.
 */

/** Le dossier ne contient-il AUCUN fichier hors `.git` ? Faux des qu'il en porte un seul. */
export function estCoquilleVide(chemin: string): boolean {
  let entrees: string[]
  try {
    entrees = readdirSync(chemin)
  } catch {
    // Dossier absent ou illisible : on ne DEVINE pas qu'il est vide. Ne rien affirmer est la seule
    // reponse sure quand la question ne peut pas etre posee.
    return false
  }
  return entrees.every((entree) => entree === '.git' || porteAucunFichier(join(chemin, entree)))
}

/** Rien d'utile sous ce chemin : ni fichier, ni fichier plus bas. */
function porteAucunFichier(chemin: string): boolean {
  let infos: ReturnType<typeof statSync>
  try {
    infos = statSync(chemin)
  } catch {
    return true
  }
  if (!infos.isDirectory()) return false
  try {
    return readdirSync(chemin).every((entree) => porteAucunFichier(join(chemin, entree)))
  } catch {
    return true
  }
}

/**
 * Supprime les coquilles vides directement sous `racine` et rend leurs noms.
 *
 * Ne descend QUE d'un niveau : chaque entree de `racine` est un bureau, et un sous-dossier vide
 * DANS un bureau porteur n'est pas une coquille — c'est une partie de son travail.
 */
export function balayerCoquillesVides(racine: string): string[] {
  let bureaux: string[]
  try {
    bureaux = readdirSync(racine)
  } catch {
    return []
  }
  const supprimes: string[] = []
  for (const nom of bureaux) {
    const chemin = join(racine, nom)
    try {
      if (!statSync(chemin).isDirectory()) continue
      if (!estCoquilleVide(chemin)) continue
      rmSync(chemin, { recursive: true, force: true })
      supprimes.push(nom)
    } catch {
      // Une coquille qu'on n'a pas pu retirer reste en place : elle sera revue au prochain passage.
      // Echouer bruyamment ici bloquerait un demarrage pour un dossier d'1 Mo.
    }
  }
  return supprimes
}
