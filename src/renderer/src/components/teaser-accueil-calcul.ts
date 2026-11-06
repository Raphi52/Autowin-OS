/**
 * Où poser la phrase sur la vidéo d'accueil (2026-10-31 ; film refait). La
 * vidéo est recadrée par `object-fit: cover`, donc sa taille dépend du fil : tout part de ses
 * repères, en parts de son image. Ils viennent du rendu (`teaser-fil/scene.js` du projet du film,
 * voir `TeaserAccueil.tsx`) : un nouveau rendu qui les bouge les change ici aussi.
 */
export const IMAGE_TEASER = { largeur: 1280, hauteur: 720 } as const
/** Le haut de la phrase, depuis le haut de l'image : dans le bas que le film assombrit pour elle. */
export const HAUT_DE_LA_PHRASE = 0.79
/**
 * Doit rester la valeur `object-position` de `.at-video` : c'est le même recadrage. 60 % : la
 * carte du film est au centre, la phrase en bas ; une coupe surtout par le haut (85 %, le cadrage
 * du magicien) entamait le nom écrit en haut de la carte dans un fil large.
 */
export const CADRAGE_VERTICAL = 0.6
/** Place gardée sous le haut de la phrase : son nom et deux lignes, même dans une fenêtre basse. */
const PLACE_DE_LA_PHRASE = 92

/** Une seule intro par lancement : un fil vide s'ouvre à chaque « Nouveau fil ». */
export const teaserVu = { intro: false }

/** La vitesse de la boucle quand un agent travaille : le temps s'accélère. */
export const VITESSE_AU_TRAVAIL = 1.6

/**
 * LE MONTAGE DE LA BOUCLE, le même que `teaser-fil/scene.js` (SEG, SCENES) : dix scènes, une skill
 * puis une vue (« des exemples genre /draft blablabla »). 2 s d'abord, puis 5 s : « je
 * trouve que 2 secondes c trop rapide [...] fais des anim de 5 secondes ». Sous une scène de skill,
 * l'usage de CETTE skill : la phrase s'écrit avec sa carte et se disperse avant la suivante. Une vue
 * n'a pas de phrase : son nom est écrit dans le film.
 */
const DUREE_D_UNE_SCENE = 5
export const SCENES_DU_FILM = [
  '/draft',
  null, // Agent Studio
  '/scout',
  null, // Workflows
  '/grill',
  null, // Board
  '/judge',
  null, // Task Manager
  '/arena',
  null // Knowledge
] as const
/** La carte du film est posée vers 0,4 s : la phrase commence à s'écrire juste avant. */
const ENTREE_PHRASE = 0.35
const SORTIE_PHRASE = 4.45
const FIN_DE_LA_SORTIE = 4.8

export type EtatDePhrase = 'absente' | 'presente' | 'sortante'
export type MomentDuFilm = { etat: EtatDePhrase; skill: string | null }

/** Où en est la phrase, et laquelle, d'après le temps de la vidéo : il suit la vitesse du film, seul. */
export function momentDuFilm(tempsVideo: number): MomentDuFilm {
  const rang = Math.floor(tempsVideo / DUREE_D_UNE_SCENE) % SCENES_DU_FILM.length
  const skill = SCENES_DU_FILM[rang] ?? null
  const dansLaScene = tempsVideo % DUREE_D_UNE_SCENE
  if (!skill || dansLaScene < ENTREE_PHRASE || dansLaScene >= FIN_DE_LA_SORTIE) {
    return { etat: 'absente', skill: null }
  }
  return { etat: dansLaScene < SORTIE_PHRASE ? 'presente' : 'sortante', skill }
}

export type PlaceDeLaPhrase = {
  /** Le haut de la phrase, en px depuis le haut du fil. */
  haut: number
}

export function placeDeLaPhrase(largeurFil: number, hauteurFil: number): PlaceDeLaPhrase {
  const echelle = Math.max(largeurFil / IMAGE_TEASER.largeur, hauteurFil / IMAGE_TEASER.hauteur)
  const hauteurImage = IMAGE_TEASER.hauteur * echelle
  const decalage = (hauteurFil - hauteurImage) * CADRAGE_VERTICAL
  const haut = Math.min(
    decalage + hauteurImage * HAUT_DE_LA_PHRASE,
    hauteurFil - PLACE_DE_LA_PHRASE
  )
  return { haut }
}

/**
 * LA FRAPPE D'UN HUMAIN (2026-11-04) : « l'invocation des phrases ça a plus de sens sans
 * le sorcier, fais-les s'écrire comme un humain qui tape au clavier, lettre par lettre ». En ms depuis
 * l'entrée de la phrase : un temps avant la première touche, environ une touche toutes les 62 ms,
 * jamais au même pas, une hésitation à chaque espace et un temps après le nom de la skill. Une longue
 * phrase garde ce rythme, resserré pour finir avant `max` : elle doit se lire avant de partir.
 */
export const FRAPPE = { debut: 240, touche: 62, alea: 0.45, espace: 70, apresNom: 300, max: 2600 }

/** Toujours le même tirage pour une touche : rien ne saute si la phrase se redessine. */
function tirage(rang: number): number {
  const s = Math.sin(rang * 12.9898 + 4.1414) * 43758.5453
  return s - Math.floor(s)
}

/** L'instant où paraît chaque lettre du nom puis de l'usage (les espaces se tapent sans en être). */
export function retardsDeFrappe(nom: string, usage: string): { nom: number[]; usage: number[] } {
  let instant = FRAPPE.debut
  let touche = 0
  const taper = (texte: string): number[] => {
    const lettres: number[] = []
    let premiere = true
    for (const signe of Array.from(texte)) {
      // Par points de code, comme l'affichage : un emoji est une seule touche.
      if (!premiere || touche > 0) {
        instant += FRAPPE.touche * (1 + FRAPPE.alea * (2 * tirage(touche) - 1))
      }
      premiere = false
      touche += 1
      if (signe === ' ') {
        instant += FRAPPE.espace
        continue
      }
      lettres.push(instant)
    }
    return lettres
  }
  const duNom = taper(nom)
  instant += FRAPPE.apresNom
  // L'espace entre le nom et l'usage se tape aussi.
  instant += FRAPPE.touche * (1 + FRAPPE.alea * (2 * tirage(touche) - 1))
  touche += 1
  const deLUsage = taper(usage)
  const fin = Math.max(...duNom, ...deLUsage, FRAPPE.debut)
  const serre = fin > FRAPPE.max ? (FRAPPE.max - FRAPPE.debut) / (fin - FRAPPE.debut) : 1
  const poser = (t: number): number => Math.round(FRAPPE.debut + (t - FRAPPE.debut) * serre)
  return { nom: duNom.map(poser), usage: deLUsage.map(poser) }
}
