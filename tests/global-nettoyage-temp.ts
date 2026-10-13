import { tmpdir } from 'node:os'
import {
  desinscrireSuite,
  inscrireSuite,
  nettoyerDossiersTemporairesDeTest,
  purgerDossiersTemporairesAnciens
} from './temp-cleanup'

/** Au-dela de 24 h, un dossier temporaire n'appartient plus a aucun appel ni a aucune suite. */
const AGE_DE_PURGE_MS = 24 * 60 * 60 * 1000

/**
 * Le cycle de vie du nettoyage d'UNE suite : inscription au départ, nettoyage puis désinscription à la
 * fin. Paramétrable pour être joué sur une racine JOUET par `temp-cleanup.test.ts` (deux suites qui se
 * chevauchent) ; la suite réelle passe par l'export par défaut, sur le dossier temporaire du système.
 *
 * La suite s'inscrit au registre des suites en cours (`REGISTRE_DES_SUITES`) : une AUTRE suite qui
 * finit pendant qu'elle tourne épargne alors les dossiers nés depuis son départ. Désinscription APRÈS
 * le nettoyage : tant qu'elle nettoie, elle tourne encore.
 */
export function nettoyageDeSuite(
  racine: string = tmpdir(),
  pid: number = process.pid,
  debutDuRun: number = Date.now()
): () => void {
  const moi = inscrireSuite(racine, pid, debutDuRun)

  return function teardown(): void {
    const resultat = nettoyerDossiersTemporairesDeTest(racine, debutDuRun, moi?.id)
    desinscrireSuite(racine, moi)
    const purge = purgerDossiersTemporairesAnciens(racine, Date.now(), AGE_DE_PURGE_MS)
    if (purge.supprimes.length > 0) {
      console.log(`[nettoyage temporaire] ${purge.supprimes.length} residu(s) de plus de 24 h purge(s)`)
    }
    if (resultat.supprimes.length > 0 || resultat.echecs.length > 0) {
      // Une ligne, à la fin : le nettoyage doit être VISIBLE, sinon personne ne saura qu'il agit.
      console.log(
        `[nettoyage temporaire] ${resultat.supprimes.length} dossier(s) supprimé(s)` +
          (resultat.echecs.length > 0 ? `, ${resultat.echecs.length} verrouillé(s)` : '')
      )
    }
  }
}

/**
 * TEARDOWN GLOBAL — range les dossiers temporaires que la suite vient de créer.
 *
 * Pourquoi ici et pas dans chaque fichier de test : ~240 fichiers appellent `mkdtempSync` sans
 * jamais supprimer. Les corriger un par un demanderait autant d'éditions, et le prochain test écrit
 * oublierait à nouveau. Le cycle de vie de la suite appartient à cet endroit — c'est donc ici qu'on
 * le ferme.
 *
 * L'instant de démarrage est capturé au SETUP : seuls les dossiers nés après lui sont supprimés.
 * La logique, ses gardes et ses cas limites sont décrits dans `temp-cleanup.test.ts`.
 */
export default function setup(): () => void {
  return nettoyageDeSuite()
}
