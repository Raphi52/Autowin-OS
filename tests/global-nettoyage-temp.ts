import { tmpdir } from 'node:os'
import { nettoyerDossiersTemporairesDeTest } from './temp-cleanup'

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
  const debutDuRun = Date.now()

  return function teardown(): void {
    const resultat = nettoyerDossiersTemporairesDeTest(tmpdir(), debutDuRun)
    if (resultat.supprimes.length > 0 || resultat.echecs.length > 0) {
      // Une ligne, à la fin : le nettoyage doit être VISIBLE, sinon personne ne saura qu'il agit.
      console.log(
        `[nettoyage temporaire] ${resultat.supprimes.length} dossier(s) supprimé(s)` +
          (resultat.echecs.length > 0 ? `, ${resultat.echecs.length} verrouillé(s)` : '')
      )
    }
  }
}
