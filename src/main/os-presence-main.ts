/**
 * APPLIQUER la présence système (jauge de barre des tâches + texte de l'icône de notification).
 *
 * Les cibles sont passées en paramètres et réduites à ce qu'on leur demande : le test double la
 * fenêtre et l'icône par des faux objets, comme `headless-instance.test.ts:41` le fait déjà pour
 * `flashFrame`. Aucun import d'Electron ici.
 */
import { presenceSysteme, type EtatRunsVivants, type PresenceSysteme } from '../shared/os-presence'

/** Le strict minimum d'une fenêtre pour porter une jauge de barre des tâches. */
export type FenetreAJauge = {
  isDestroyed(): boolean
  setProgressBar(progression: number, options?: { mode: 'none' | 'normal' | 'indeterminate' }): void
}

/** Le strict minimum d'une icône de zone de notification. */
export type IconeNotification = { setToolTip(texte: string): void }

export function appliquerPresenceSysteme(
  cibles: { fenetre?: FenetreAJauge | null; icone?: IconeNotification | null },
  etat: EtatRunsVivants
): PresenceSysteme {
  const presence = presenceSysteme(etat)
  const { fenetre, icone } = cibles
  if (fenetre && !fenetre.isDestroyed()) {
    try {
      fenetre.setProgressBar(presence.progression, { mode: presence.mode })
    } catch {
      // Plateforme sans jauge de barre des tâches : ce n'est pas une panne du run.
    }
  }
  if (icone) {
    try {
      icone.setToolTip(presence.infobulle)
    } catch {
      // Zone de notification indisponible : idem, best-effort comme la création du tray.
    }
  }
  return presence
}
