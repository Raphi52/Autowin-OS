import { existsSync, lstatSync, symlinkSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Rend les dependances du depot ATTEIGNABLES depuis une copie agent.
 *
 * LE DEFAUT, mesure le 2026-08-25 sur le run
 * `je-vois-toujours-le-fond-d-ecran-qui-est-mt8bi0ky` (conv-1397). Une copie agent est un
 * `git worktree add` : elle ne contient QUE les fichiers suivis. `node_modules` etant ignore par
 * git, il n'y est pas. Mesure directe dans une copie fraiche :
 *
 *     npx vitest run <un test>
 *     -> Error: Cannot find module 'vitest/config'   (exit 1)
 *
 * vitest ne charge meme pas sa configuration. Aucun agent ne pouvait donc produire la moindre
 * PREUVE EXECUTABLE depuis sa propre copie.
 *
 * LA CONSEQUENCE, et c'est elle qui fait mal : sans preuve executable, `evidenceOk` vaut faux,
 * `etatDeCloture` rend `red`, et le controle final affiche « Echec deja declare : ce travail s'est
 * lui-meme termine en echec ». La boucle de reparation s'arrete alors d'elle-meme -- a raison, ce
 * refus est hors de portee d'un rejeu. Un travail REELLEMENT fait et prouve (rouge -> vert ->
 * mutant rejete, le run le montre) etait rendu comme un echec.
 *
 * POURQUOI UNE JONCTION ET PAS UNE COPIE. `node_modules` pese plusieurs centaines de Mo ici : le
 * copier a chaque copie agent couterait des minutes et un disque, pour un contenu identique produit
 * par le meme `package-lock.json` sur la meme machine. Une jonction NTFS est instantanee, ne coute
 * rien, et ne demande aucun droit administrateur -- contrairement a un lien symbolique de fichier
 * sous Windows.
 *
 * LE RISQUE, NOMME : les modules sont PARTAGES avec le depot reel. Un `npm install` lance dans une
 * copie agent ecrit donc dans les modules du depot. C'est un vrai risque, assume ici parce que
 * l'alternative mesuree est pire : sans lien, aucun agent ne prouve rien, et TOUT run de mutation
 * se termine en echec declare.
 */

/** Ce qui a ete fait, et pourquoi -- jamais un booleen muet : la trace du run doit pouvoir le dire. */
export type LiaisonDependances =
  | { fait: 'liees' }
  | { fait: 'deja-presentes' }
  | { fait: 'rien-a-lier'; raison: string }
  | { fait: 'echec'; raison: string }

const DOSSIER_DEPENDANCES = 'node_modules'

/**
 * Relie `node_modules` du depot dans la copie.
 *
 * NE JETTE JAMAIS. Une copie sans dependances reste utilisable pour lire et editer : faire echouer
 * la creation de la copie entiere parce que le lien n'a pas pu etre pose transformerait une gene en
 * panne. L'echec est RENDU, pour etre trace, pas avale.
 */
export function lierLesDependances(
  baseRepo: string,
  worktreePath: string,
  systeme: {
    existe: (chemin: string) => boolean
    lier: (cible: string, lien: string) => void
  } = { existe: existsSync, lier: (cible, lien) => symlinkSync(cible, lien, 'junction') }
): LiaisonDependances {
  const source = join(baseRepo, DOSSIER_DEPENDANCES)
  const destination = join(worktreePath, DOSSIER_DEPENDANCES)

  // Deja quelque chose sur place : on n'y touche pas. Ecraser des modules reels par un lien serait
  // une destruction, et c'est exactement le genre de geste qu'on ne fait pas « au passage ».
  if (systeme.existe(destination)) return { fait: 'deja-presentes' }

  // Le depot lui-meme peut ne pas avoir installe ses dependances : il n'y a alors rien a relier, et
  // ce n'est pas une anomalie a signaler comme une panne.
  if (!systeme.existe(source)) {
    return { fait: 'rien-a-lier', raison: `le depot n'a pas de ${DOSSIER_DEPENDANCES}` }
  }

  try {
    systeme.lier(source, destination)
    return { fait: 'liees' }
  } catch (erreur) {
    return {
      fait: 'echec',
      raison: erreur instanceof Error ? erreur.message : String(erreur)
    }
  }
}

/** Phrase destinee a la TRACE du run : un lien pose en silence ne s'explique pas quand il manque. */
export function messageLiaison(resultat: LiaisonDependances): string {
  switch (resultat.fait) {
    case 'liees':
      return `${DOSSIER_DEPENDANCES} relie depuis le depot : la copie peut lancer les tests.`
    case 'deja-presentes':
      return `${DOSSIER_DEPENDANCES} deja present dans la copie, laisse intact.`
    case 'rien-a-lier':
      return `${DOSSIER_DEPENDANCES} non relie : ${resultat.raison}.`
    case 'echec':
      return `${DOSSIER_DEPENDANCES} n'a pas pu etre relie (${resultat.raison}) : la copie ne pourra probablement pas lancer les tests.`
  }
}

/** Ce qu'a donne le retrait du lien avant un nettoyage. */
export type RetraitDependances =
  | { fait: 'retire' }
  | { fait: 'rien-a-retirer' }
  | { fait: 'refuse-vrai-dossier' }
  | { fait: 'echec'; raison: string }

/**
 * Retire le LIEN des dependances avant de supprimer une copie.
 *
 * POURQUOI C'EST NECESSAIRE, mesure le 2026-08-25 : `git worktree remove --force` reussit (code 0)
 * mais ne touche pas au `node_modules` qu'il ne suit pas. Le dossier de la copie SURVIT donc, ne
 * contenant plus que la jonction -- et `cleanupWorktree`, qui rend `ok` des que git a rendu 0, ne
 * s'en apercoit pas. Chaque run laisserait une coquille orpheline : exactement ce que le nettoyage
 * automatique est cense empecher.
 *
 * LA GARDE QUI COMPTE : on ne retire QUE si c'est un lien. Un VRAI dossier de modules n'est jamais
 * supprime -- une copie a pu installer les siens, et les effacer serait une destruction. La
 * distinction se lit avec `lstat`, qui NE SUIT PAS le lien.
 *
 * CE QUE COUTE `stat` A LA PLACE, mesure le 2026-09-02 (test « avec `stat` au lieu de `lstat` ») :
 * `stat` suit la jonction et repond « dossier », donc la garde croit voir de VRAIS modules et REFUSE
 * d'y toucher -- le lien survit, et avec lui la coquille orpheline. Ce n'est PAS une destruction :
 * mesure le meme jour, un effacement recursif (`fs.rmSync({recursive})`, `rm -rf`, `rmdir /s`) NE
 * TRAVERSE PAS une jonction NTFS ; la jonction part, sa cible reste intacte.
 */
export function delierLesDependances(
  worktreePath: string,
  systeme: {
    estUnLien: (chemin: string) => boolean | undefined
    retirer: (chemin: string) => void
  } = {
    estUnLien: (chemin) => {
      try {
        return lstatSync(chemin).isSymbolicLink()
      } catch {
        return undefined
      }
    },
    retirer: (chemin) => unlinkSync(chemin)
  }
): RetraitDependances {
  const cible = join(worktreePath, DOSSIER_DEPENDANCES)
  const lien = systeme.estUnLien(cible)
  if (lien === undefined) return { fait: 'rien-a-retirer' }
  if (!lien) return { fait: 'refuse-vrai-dossier' }
  try {
    systeme.retirer(cible)
    return { fait: 'retire' }
  } catch (erreur) {
    return { fait: 'echec', raison: erreur instanceof Error ? erreur.message : String(erreur) }
  }
}
