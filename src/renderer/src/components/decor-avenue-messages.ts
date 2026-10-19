/**
 * Ce que la page et le Worker du fond avenue s'échangent (decor-avenue-hote.ts ↔
 * decor-avenue.worker.ts). Un seul fichier de types : les deux côtés ne peuvent pas diverger.
 */

/** De la page vers le Worker. */
export type MessageVersDecor =
  | {
      type: 'monter'
      canvas: OffscreenCanvas
      /** Densité de pixels de l'écran : le Worker n'a pas `window.devicePixelRatio`. */
      ratio: number
    }
  | { type: 'taille'; largeur: number; hauteur: number; ratio: number }
  /** Dessiner UNE image : `temps` en secondes (horloge du décor), `regard` dans [-1, 1]. */
  | { type: 'image'; temps: number; regard: { x: number; y: number } }
  | { type: 'liberer' }
  /**
   * INTERNE AU WORKER : le reflet de l'image suivante, dans sa propre tâche juste après l'image
   * (decor-avenue.worker.ts, conv-347). Il passe par le même point d'entrée que les messages de la
   * page pour que les sondes (scripts/banc-decor-budget.mjs) le comptent avec son image.
   */
  | { type: 'reflet' }

/** Du Worker vers la page. */
export type MessageDuDecor =
  /** La scène est montée (`ok`), ou ne peut pas l'être dans le Worker (la page reprend la main). */
  | { type: 'montee'; ok: boolean; erreur?: string }
  /** L'image demandée est dessinée ; `ms` = ce qu'elle a coûté au Worker. */
  | { type: 'rendue'; ms: number }
  /** La première image de la rue est dessinée : la page lance le fondu d'entrée du canevas. */
  | { type: 'apparue' }
  /** Une marque de temps posée par le décor, recopiée dans le journal de performance de la page. */
  | { type: 'marque'; nom: string }
