/**
 * LA JAUGE — répondre, sans micro, à « est-ce que je parle dans le vide ? ».
 *
 * Le moteur remonte un niveau efficace (RMS) brut, entre 0 et 1. Affiché tel quel, une voix normale
 * (~0,05) occuperait 5 % de la barre : l'utilisateur y lirait « il ne m'entend pas » ALORS qu'il est
 * entendu. La conversion est donc en décibels, parce que c'est l'échelle où l'oreille juge.
 *
 * Ces fonctions sont PURES : c'est ici que se prouve, sans navigateur, ce que la barre affiche.
 */

/** Plancher de la jauge : sous −60 dBFS, c'est du silence de salle. */
export const DB_PLANCHER = -60

export type VerdictMicro = 'coupe' | 'silence' | 'faible' | 'bon' | 'sature'

/** Le RMS en fraction de barre [0,1], sur une échelle en décibels. */
export function fractionJauge(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0
  const db = 20 * Math.log10(rms)
  if (db <= DB_PLANCHER) return 0
  return Math.min(1, 1 - db / DB_PLANCHER)
}

/**
 * Ce que l'utilisateur doit LIRE. `creteRecente` = le plus haut niveau vu dans la fenêtre récente :
 * juger sur l'instantané ferait clignoter « silence » entre deux syllabes.
 */
export function verdictMicro(actif: boolean, creteRecente: number, seuil: number): VerdictMicro {
  if (!actif) return 'coupe'
  if (creteRecente >= 0.7) return 'sature'
  if (creteRecente >= seuil * 2) return 'bon'
  if (creteRecente >= seuil) return 'faible'
  return 'silence'
}

export const MESSAGE_VERDICT: Record<VerdictMicro, string> = {
  coupe: 'Micro coupé',
  silence: 'Aucun son détecté — vérifiez le micro ou la sensibilité',
  faible: 'Son faible — parlez plus près du micro',
  bon: 'Micro OK — je vous entends',
  sature: 'Son saturé — éloignez-vous du micro'
}
