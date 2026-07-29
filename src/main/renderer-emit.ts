/**
 * ÉMISSION VERS LE RENDERER — survie à la fermeture de la fenêtre.
 *
 * Défaut corrigé (2026-07-28) : les deux flux longs (`orchestrate:step`, `pilot:event`) émettaient
 * via `event.sender.send(...)`, c'est-à-dire vers le WebContents **capturé au lancement de l'appel**.
 * Or l'app revendique explicitement la survie à la fermeture de fenêtre (le process reste en tray et
 * le tour continue). Deux conséquences quand la fenêtre est fermée en cours de tour :
 *   1. `send()` sur un WebContents détruit lève « Object has been destroyed » — l'exception remonte
 *      dans le callback d'événement et peut faire ÉCHOUER une tâche longue déjà payée ;
 *   2. même sans erreur, rouvrir la fenêtre ne rebranche rien : les événements suivants partent vers
 *      un destinataire mort.
 *
 * Le patron correct existait déjà trois lignes plus haut (`broadcast()` : diffusion à toutes les
 * fenêtres vivantes). Ce module le généralise et garantit surtout une chose : **émettre ne peut
 * jamais casser le tour**.
 */

/** Fenêtre minimale nécessaire à l'émission (permet de tester sans Electron). */
export interface EmitTarget {
  isDestroyed?: () => boolean
  webContents?: {
    isDestroyed?: () => boolean
    send: (channel: string, ...args: unknown[]) => void
  }
}

export interface EmitResult {
  /** Nombre de fenêtres ayant réellement reçu l'événement. */
  delivered: number
  /** Fenêtres ignorées (détruites) ou en échec — comptées, jamais propagées. */
  skipped: number
}

/**
 * Émet vers toutes les fenêtres VIVANTES. Ne jette JAMAIS : un destinataire mort est un non-événement,
 * pas une erreur de la tâche en cours. Une fenêtre qui échoue n'empêche pas les autres de recevoir.
 */
export function emitToLiveWindows(
  windows: readonly EmitTarget[],
  channel: string,
  payload: unknown
): EmitResult {
  let delivered = 0
  let skipped = 0
  for (const window of windows) {
    try {
      if (window.isDestroyed?.() === true || window.webContents?.isDestroyed?.() === true) {
        skipped += 1
        continue
      }
      const contents = window.webContents
      if (!contents) {
        skipped += 1
        continue
      }
      contents.send(channel, payload)
      delivered += 1
    } catch {
      // « Object has been destroyed » et assimilés : la fenêtre a disparu entre la vérification et
      // l'envoi (course réelle). On compte et on continue — le tour ne doit pas en souffrir.
      skipped += 1
    }
  }
  return { delivered, skipped }
}
