/**
 * PRÉSENCE SYSTÈME des runs : ce que l'OS montre quand la fenêtre n'est pas regardée.
 *
 * Pourquoi : avant ce fichier, l'icône de barre des tâches restait inerte pendant un run de
 * plusieurs minutes (`setProgressBar` : aucune occurrence dans `src`) et l'icône de la zone de
 * notification portait un texte FIGÉ. Le seul bruit du produit était la notification d'abandon
 * (`src/main/os.ts:451`). Un travail en cours ne se voyait donc nulle part hors de la fenêtre.
 *
 * Fonction PURE, sans Electron : le calcul est testable, l'application des valeurs vit dans
 * `src/main/os-presence-main.ts`.
 */

/** Ce que le renderer sait des runs vivants — seul lui tient cette liste. */
export type EtatRunsVivants = {
  /** Nombre de runs en cours (status `running`). */
  runsActifs: number
  /** Étapes terminées, toutes runs actives confondues. */
  etapesFaites: number
  /** Étapes attendues au total ; 0 si le plan n'est pas connu. */
  etapesTotales: number
}

export type PresenceSysteme = {
  /**
   * Valeur pour `BrowserWindow.setProgressBar` : `-1` efface la jauge, `0..1` la remplit.
   * En mode `indeterminate` la valeur est ignorée par Electron mais reste bornée.
   */
  progression: number
  mode: 'none' | 'normal' | 'indeterminate'
  /** Texte de l'icône de la zone de notification. */
  infobulle: string
}

const INFOBULLE_REPOS = 'Autowin OS — actif (les runs continuent fenêtre fermée)'

export function presenceSysteme(etat: EtatRunsVivants): PresenceSysteme {
  const runsActifs = Math.max(0, Math.floor(etat.runsActifs || 0))
  if (runsActifs === 0) return { progression: -1, mode: 'none', infobulle: INFOBULLE_REPOS }
  const infobulle =
    runsActifs === 1
      ? 'Autowin OS — 1 travail en cours'
      : `Autowin OS — ${runsActifs} travaux en cours`
  const total = Math.max(0, Math.floor(etat.etapesTotales || 0))
  // Plan inconnu : on montre que ça travaille sans mentir sur l'avancement.
  if (total <= 0) return { progression: 0, mode: 'indeterminate', infobulle }
  const faites = Math.min(total, Math.max(0, Math.floor(etat.etapesFaites || 0)))
  return { progression: faites / total, mode: 'normal', infobulle }
}
