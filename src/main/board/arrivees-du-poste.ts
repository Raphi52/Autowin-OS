/**
 * Les arrivées sur main de CE poste : une seule lecture partagée par la carte du Board et par les
 * fiches, pour que les deux disent la même chose (`arrivee-sur-main.ts` pour la règle).
 */
import { app } from 'electron'
import { join } from 'node:path'
import { creerLectureDesArrivees, lireLogDeMain, type ArriveeDuTour } from './arrivee-sur-main'

let lecture: (() => ArriveeDuTour) | undefined

/**
 * `dossierDuDepot` : un dossier du dépôt de l'app (son espace de travail), pour lire le journal de `main`.
 * Si le dossier des runs ne peut pas être ouvert, aucune arrivée n'est prouvée : la carte garde son
 * calcul (les orchestrations « en attente » restent sans preuve ou refusées), et l'erreur est dite une fois.
 * Comme `lireFiches` : un index illisible ne casse pas le Board.
 */
export function arriveesDuPoste(dossierDuDepot: () => string): ArriveeDuTour {
  if (!lecture) {
    try {
      lecture = creerLectureDesArrivees(join(app.getPath('userData'), 'worktrees'), {
        lireLog: () => lireLogDeMain(dossierDuDepot())
      })
    } catch (erreur) {
      console.warn(
        '[board] arrivées sur main indisponibles :',
        erreur instanceof Error ? erreur.message : erreur
      )
      lecture = () => () => undefined
    }
  }
  return lecture()
}
