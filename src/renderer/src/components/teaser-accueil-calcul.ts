/**
 * Où poser la phrase sur la vidéo d'accueil (conv-1401, 2026-10-31). La vidéo est recadrée par
 * `object-fit: cover`, donc sa taille dépend du fil : tout part de ses repères, en parts de son
 * image. Ils viennent de la caméra du rendu : un nouveau rendu qui bouge la caméra les change.
 */
export const IMAGE_TEASER = { largeur: 1280, hauteur: 720 } as const
/** Le centre du cercle de runes, depuis le haut de l'image. */
export const CERCLE_DANS_L_IMAGE = 0.823
/** Doit rester la valeur `object-position` de `.at-video` : c'est le même recadrage. */
export const CADRAGE_VERTICAL = 0.85
/** Le bas du cercle, depuis son centre, en part de l'image : la phrase commence juste dessous. */
const BAS_DU_CERCLE = 0.06
/** Place gardée sous le haut de la phrase : son nom et deux lignes, même dans une fenêtre basse. */
const PLACE_DE_LA_PHRASE = 92

/** Une seule intro par lancement : un fil vide s'ouvre à chaque « Nouveau fil ». */
export const teaserVu = { intro: false }

/** La vitesse de la boucle quand un agent travaille : le temps s'accélère. */
export const VITESSE_AU_TRAVAIL = 1.6

/**
 * LE MONTAGE DE LA BOUCLE, le même que `scripts/teaser-accueil/timeline.cjs` : un temps de 10 s
 * s'ouvre sur le plan large : le mage lève son bâton et frappe le sol, le cercle lance sa colonne de
 * lumière. La caméra tourne autour du cercle, qui reste à sa place à l'écran. Viennent ensuite les
 * plans serrés, à 6 s. La phrase sort du cercle juste après le coup, et se disperse avant la coupe.
 */
const DUREE_D_UN_TEMPS = 10
const ENTREE_PHRASE = 1
const SORTIE_PHRASE = 5.35
const FIN_DE_LA_SORTIE = 5.8

export type EtatDePhrase = 'absente' | 'presente' | 'sortante'

/** Où en est la phrase, d'après le temps de la vidéo : il suit la vitesse du film, seul. */
export function etatDeLaPhrase(tempsVideo: number): EtatDePhrase {
  const dansLeTemps = tempsVideo % DUREE_D_UN_TEMPS
  if (dansLeTemps < ENTREE_PHRASE || dansLeTemps >= FIN_DE_LA_SORTIE) return 'absente'
  return dansLeTemps < SORTIE_PHRASE ? 'presente' : 'sortante'
}

export type PlaceDeLaPhrase = {
  /** Le haut de la phrase, en px depuis le haut du fil. */
  haut: number
  /** Du haut de la phrase au centre du cercle de runes : le chemin de ses lettres. */
  ecart: number
}

export function placeDeLaPhrase(largeurFil: number, hauteurFil: number): PlaceDeLaPhrase {
  const echelle = Math.max(largeurFil / IMAGE_TEASER.largeur, hauteurFil / IMAGE_TEASER.hauteur)
  const hauteurImage = IMAGE_TEASER.hauteur * echelle
  const decalage = (hauteurFil - hauteurImage) * CADRAGE_VERTICAL
  const centre = decalage + hauteurImage * CERCLE_DANS_L_IMAGE
  const haut = Math.min(centre + hauteurImage * BAS_DU_CERCLE, hauteurFil - PLACE_DE_LA_PHRASE)
  return { haut, ecart: haut - centre }
}
