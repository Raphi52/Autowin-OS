/**
 * LES DOSSIERS OÙ UNE TÂCHE PLANIFIÉE PEUT TRAVAILLER — le menu « Dossier de travail » du formulaire
 * du Task Manager. Une tâche n'avait aucun dossier réglable : son fil partait d'office dans le dossier
 * d'Autowin, et avec lui sur le Board et dans le village des collègues.
 *
 * Fonction pure, à part du composant : un fichier de composant qui exporte autre chose qu'un
 * composant perd le rechargement à chaud.
 */
import { canonicalProjectPath, estCheminDeDossier } from '../../../shared/project-path'
import { nomDeDossier } from './conversation-groups'

/** Un dossier proposé dans le formulaire : sa clé canonique et son nom lisible. */
export interface DossierPropose {
  chemin: string
  libelle: string
}

/**
 * « This computer », le dépôt d'Autowin, ceux du Chat, puis celui déjà choisi s'il n'y est plus :
 * un choix enregistré ne disparaît jamais du menu. Deux écritures d'un même dossier n'en font qu'un.
 */
export function dossiersProposesPourLaTache(entree: {
  personnel: string | null
  depot: string | null
  duChat: readonly string[]
  choisi?: string
  nomDuPersonnel: string
}): DossierPropose[] {
  const vus = new Set<string>()
  const sortie: DossierPropose[] = []
  const ajouter = (brut: string | null | undefined, libelle?: string): void => {
    const chemin = canonicalProjectPath(brut)
    if (!chemin || !estCheminDeDossier(chemin)) return
    const cle = chemin.toLowerCase()
    if (vus.has(cle)) return
    vus.add(cle)
    sortie.push({ chemin, libelle: libelle ?? `${nomDeDossier(chemin)} · ${chemin}` })
  }
  ajouter(entree.personnel, entree.nomDuPersonnel)
  ajouter(entree.depot)
  for (const dossier of entree.duChat) ajouter(dossier)
  ajouter(entree.choisi)
  return sortie
}
