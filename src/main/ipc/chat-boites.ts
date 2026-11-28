import type { creerRepriseDesFils } from '../chat/reprise-fil-apres-quota'
import type { RelanceurTachesDeFond } from '../chat/relance-taches-de-fond'
import type { lancerLaReparationDuRefus } from '../chat/reparation-du-refus'
import type { CoordinateurDesPlans } from '../orchestration/plans-de-lots-app'
import type { FileGitApresFil } from '../git/git-apres-fil'

/*
 * LES BOÎTES PARTAGÉES ENTRE LES MODULES DU CHAT (src/main/ipc/chat-*.ts).
 *
 * Chacune est déclarée VIDE en tête de `registerChatIpc`, passée aux modules qui la lisent, puis
 * remplie par le module qui construit son contenu, plus tard dans le démarrage : qui la remplit et
 * quand est écrit sur sa déclaration, dans chat.ts. Un module qui la lit le fait dans un rappel, donc
 * après le remplissage. Le type vit ici pour que les modules le nomment sans importer chat.ts.
 */

/** La reprise des fils coupés par le quota. */
export interface SuiviDesFilsCoupes {
  reprise?: ReturnType<typeof creerRepriseDesFils>
}

/** Le relanceur des tâches de fond d'un tour. */
export interface RelanceTachesDeFond {
  relanceur?: RelanceurTachesDeFond
}

/** Le coordinateur des plans de lots. */
export interface SuiviDesPlans {
  coordinateur?: CoordinateurDesPlans
}

/** La file des publications `/git` après un fil. */
export interface SuiviGitApresFil {
  file?: FileGitApresFil
}

/** Le lanceur du tour qui répare un refus d'intégration. */
export interface ReparationDuRefus {
  envoyerTour?: Parameters<typeof lancerLaReparationDuRefus>[0]['envoyerTour']
}
