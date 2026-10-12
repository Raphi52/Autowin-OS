import { createContext } from 'react'

/** Un moment pointé dans une vidéo du fil : la référence à insérer et l'image affichée (PNG). */
export interface MomentPointe {
  reference: string
  /** `null` si l'image n'a pas pu être capturée : la référence est insérée quand même. */
  image: File | null
}

/**
 * Relie le lecteur vidéo d'une carte du fil à la zone de saisie (conv-253, 2026-10-11).
 * Fourni par `ChatView` ; un contexte plutôt qu'une prop pour ne pas toucher le fil MÉMOÏSÉ
 * (`filRendu`) ni chaque niveau entre la vue et la carte. Sans fournisseur, pas de bouton.
 */
export const PointerMomentVideo = createContext<((moment: MomentPointe) => void) | null>(null)
