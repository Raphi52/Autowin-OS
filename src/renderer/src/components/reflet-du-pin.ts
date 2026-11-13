/**
 * LE REFLET DU PIN, REJOUE TEL QUEL — la lumiere qui court sur le bord des blocs encadres du fil
 * (Raisonnement, Actions, Etapes, images, decodage, scene 3D).
 *
 * Le modele est l'anneau d'un bouton de verre, l'epingle Pinterest 941744972113082896 (video de 5 s
 * a 30 images/s, en boucle). Deux essais l'avaient INTERPRETE — une vague diagonale qui traversait
 * les blocs, puis une palette et des franges choisies a la main — et s'en ecartaient (demande du
 * 2026-11-13 : « reproduire a la perfection », puis « t'as des biais par rapport aux trucs que je
 * t'ai dit »). Ici, plus rien n'est interprete : scripts/anneau-du-pin.py a releve l'anneau de
 * chacune des 150 images, degre par degre (texture `anneau-du-pin.webp`), et ce module la repeint
 * le long du bord de chaque bloc. Ce que fait la video, le bloc le fait : deux reflets presque fixes
 * a 11 h et 7 h qui respirent, une gerbe de blanc qui part de midi et s'etale vers 4 h avant de
 * retomber, des stries irisees, un anneau jamais tout a fait eteint.
 *
 * LE PASSAGE DU CERCLE AU BLOC : midi = le milieu du bord haut, puis le sens horaire, a pas egaux le
 * long du bord (un degre = 1/360 du tour). Les quatre points cardinaux tombent ainsi au milieu des
 * quatre cotes, quelle que soit la forme du bloc. Un reflet y est plus long que sur le pin (2,8
 * epaisseurs de trait pour un blanc de 4 degres sur un bloc de 356 px, 0,5 sur le pin) : le tour
 * entier doit couvrir tout le bord, l'etirement MOYEN est donc fixe par la forme du bloc. Repartir
 * les degres selon l'angle vu du centre ne le reduit pas, il le desequilibre (0,5 a midi, 17,7 pres
 * des coins : calcul du 2026-11-13) ; d'ou les pas egaux.
 *
 * DEUX COUCHES, deux canvas :
 * - L'ANNEAU (3 px), net, a la resolution de l'ecran : ses trois tiers de couleur, pris tels quels
 *   dans la texture.
 * - LA LUMIERE, douce, un pixel pour ECHELLE_LUEUR px (le navigateur l'agrandit en la lissant) : la
 *   lueur dehors (relevee a 1 px, decroissance mesuree sur 10 px) et le VERRE du bloc, eclaire
 *   jusqu'a la profondeur du centre du bouton (19 px a l'echelle du trait) comme pendant la gerbe du
 *   pin — une part qui suit le secteur allume de l'anneau et ses voisins, une part commune a tout le
 *   bouton (`VERRE_*`). C'est une lumiere AJOUTEE au fond : elle est composee sur la
 *   couleur du fond du theme (`--bg-0`) : en theme clair, elle eclaircit a peine le fond au lieu d'y
 *   laisser des taches colorees, et elle eclaire l'anneau d'un bloc voisin sans l'effacer.
 *
 * LE TEMPS : la video est rejouee a la cadence de l'ecran (60 images/s au plus), chaque instant
 * MELANGE ses deux images voisines — a 30 images/s, chaque image restait deux rafraichissements et
 * la gerbe saccadait. Chaque bloc a son DECALAGE (0 a DECALAGE_MAX images), tire de sa place dans la
 * page : trois blocs voisins ne s'allument pas a l'identique, comme trois objets de verre, sans ordre
 * ni sens de passage.
 *
 * LE COUT reste borne : seuls les pixels de la bande du bord sont peints (tables precalculees a
 * chaque changement de taille, au plus une tous les ESPACEMENT_DES_TABLES_MS), seulement pour les
 * blocs a l'ecran (« les animations sur les blocs dans le chat doivent etre en fonction de la ou je
 * regarde »).
 */
import urlDeLaTexture from '../assets/anneau-du-pin.webp'

/** Images de la video, et leur cadence. */
export const IMAGES = 150
export const IMAGES_PAR_SECONDE = 30
/** Une colonne de texture par degre. */
export const DEGRES = 360
/** Lignes par image : lueur dedans, anneau (tiers interieur, milieu, exterieur), lueur dehors. */
export const LIGNES = 5
const LUEUR_DEDANS = 0
const ANNEAU_MILIEU = 2
const ANNEAU_EXTERIEUR = 3
const LUEUR_DEHORS = 4
/**
 * Le verre est aussi eclaire par les VOISINS d'un secteur (une gerbe large l'eclaire de biais) : la
 * lueur dedans moyennee a +-20 et +-40 degres, deux lignes ajoutees a chaque image au chargement.
 */
export const VOISINAGES = [20, 40] as const
export const LIGNES_REJOUEES = LIGNES + VOISINAGES.length
const VOISINS_20 = 5
const VOISINS_40 = 6
/** Le trait de l'anneau des blocs, en px CSS (le `padding` de `.cadre-anneau::before`). */
export const EPAISSEUR = 3
/** La lueur deborde de MARGE px hors du bloc : les canvas sont plus grands d'autant de chaque cote. */
export const MARGE = 10
/** Un pixel de la couche de lumiere couvre ECHELLE_LUEUR px CSS. */
export const ECHELLE_LUEUR = 2
/** Plus grand decalage d'un bloc sur la video, en images. */
export const DECALAGE_MAX = 15
/** Ecart minimal entre deux peintures d'un bloc : 60 images/s au plus, meme sur un ecran a 144 Hz. */
const ECART_DES_PEINTURES_MS = 15

/**
 * Decroissance de la lueur DEHORS, en px depuis le bord de l'anneau (index = distance), normee a
 * 1 px : moyenne des secteurs allumes des 150 images, imprimee par scripts/anneau-du-pin.py.
 */
export const DECROISSANCE_EXTERIEURE = [
  1.432, 1.0, 0.762, 0.625, 0.53, 0.445, 0.391, 0.347, 0.301, 0.266
] as const
/**
 * La lumiere du VERRE, en px depuis le bord interieur de l'anneau jusqu'au centre du bouton : a la
 * profondeur d, `VERRE_LOCAL[d]` x la lueur dedans du meme secteur, + `VERRE_VOISINS_20/40[d]` x
 * cette lueur moyennee a +-20 et +-40 degres, + `VERRE_COMMUN[d]` x l'eclat moyen de l'anneau sur
 * l'image, + `VERRE_SEUIL[d]` (x 255), jamais sous zero. Moindres carres sur le verre des 150 images,
 * maison du centre ecartee (scripts/anneau-du-pin.py). Le secteur seul expliquait mal la profondeur
 * (R2 = 0,81 a 10 px, pics 14 % trop bas) : la gerbe eclaire le verre de biais (R2 = 0,94 avec ses
 * voisins). Le seuil garde le verre noir au repos : sans lui, une part de la lumiere restait allumee
 * en permanence et la gerbe montait 30 a 40 % moins haut que sur le pin (films du 2026-11-13).
 */
export const VERRE_LOCAL = [
  1.6023, 0.8177, 0.341, 0.1535, 0.071, 0.0216, 0.0043, -0.0002, 0.0057, 0.0105, 0.0035, -0.0065,
  -0.0029, -0.0406, -0.0186, -0.0055, 0.0085, 0.0133, 0.0133, 0.0133
] as const
export const VERRE_VOISINS_20 = [
  -0.3562, 0.1095, 0.3903, 0.3876, 0.3389, 0.2674, 0.1925, 0.1283, 0.0644, 0.0113, 0.0102, 0.0149,
  -0.0084, -0.0318, -0.0154, -0.0354, -0.0732, -0.0381, -0.0381, -0.0381
] as const
export const VERRE_VOISINS_40 = [
  -0.0232, 0.0731, 0.0725, 0.1425, 0.209, 0.2572, 0.2851, 0.3049, 0.3156, 0.3188, 0.2893, 0.2418,
  0.2116, 0.2649, 0.1837, 0.1214, 0.1405, 0.0436, 0.0436, 0.0436
] as const
export const VERRE_COMMUN = [
  0.0251, -0.0183, -0.0137, -0.0128, -0.0138, -0.0104, -0.0082, -0.0042, -0.0024, 0.0022, 0.0074,
  0.0199, 0.0236, 0.0069, 0.0141, 0.0241, 0.0265, 0.0436, 0.0436, 0.0436
] as const
export const VERRE_SEUIL = [
  0.0003, -0.0056, -0.0051, -0.0038, -0.0019, -0.0014, -0.0007, -0.0014, -0.0015, -0.0021, -0.0039,
  -0.0099, -0.0129, -0.0033, -0.0049, -0.0083, -0.0082, -0.0162, -0.0162, -0.0162
] as const
/** Profondeur eclairee du verre, en px : celle du centre du bouton. */
export const PROFONDEUR_DU_VERRE = VERRE_LOCAL.length - 1

/** La place dans la video (en images, decimale) a l'instant `ms`, decalee de `decalage` images. */
export function positionA(ms: number, decalage = 0): number {
  const p = (ms * IMAGES_PAR_SECONDE) / 1000 + decalage
  return ((p % IMAGES) + IMAGES) % IMAGES
}

/** Une valeur d'une table mesuree a la distance `d` (px), lineaire entre deux mesures. */
export function decroissance(table: readonly number[], d: number): number {
  if (d <= 0) return table[0]
  const i = Math.floor(d)
  if (i >= table.length - 1) return table[table.length - 1]
  return table[i] + (table[i + 1] - table[i]) * (d - i)
}

/**
 * Le decalage d'un bloc sur la video (0 a DECALAGE_MAX images), tire de sa place dans la page
 * arrondie a 16 px : stable tant que le bloc ne bouge pas, sans lien d'ordre entre voisins.
 */
export function decalageDe(x: number, y: number): number {
  let h = Math.imul(Math.round(x / 16), 73856093) ^ Math.imul(Math.round(y / 16), 19349663)
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return ((h >>> 0) / 4294967296) * DECALAGE_MAX
}

/**
 * Le point d'un rectangle arrondi (l x h, rayon r, origine au coin haut-gauche) vu par le reflet :
 * `tour` = sa place sur le tour (0 = milieu du bord haut, puis sens horaire, 1 = un tour), mesuree
 * sur la ligne MEDIANE du trait ; `distance` = sa distance signee au bord exterieur du bloc (negative
 * dedans), en px.
 */
export function pointDuBord(
  x: number,
  y: number,
  l: number,
  h: number,
  r: number
): { tour: number; distance: number } {
  const rayon = Math.max(0, Math.min(r, l / 2, h / 2))
  const a = l / 2 - rayon
  const b = h / 2 - rayon
  const px = x - l / 2
  const py = y - h / 2
  // Distance au bord : celle d'une boite arrondie (coeur a x b, gonfle de `rayon`).
  const qx = Math.abs(px) - a
  const qy = Math.abs(py) - b
  const distance =
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - rayon
  // La ligne mediane du trait : meme centres de coins, rayon diminue d'une demi-epaisseur.
  const arc = (Math.max(0, rayon - EPAISSEUR / 2) * Math.PI) / 2
  const perimetre = 4 * a + 4 * b + 4 * arc
  let vx = px - Math.max(-a, Math.min(a, px))
  let vy = py - Math.max(-b, Math.min(b, py))
  if (vx === 0 && vy === 0) {
    // Dans le coeur (bloc minuscule) : le cote le plus proche.
    const versCotes = [b + py, a - px, b - py, a + px] // haut, droite, bas, gauche
    const i = versCotes.indexOf(Math.min(...versCotes))
    vx = i === 1 ? 1 : i === 3 ? -1 : 0
    vy = i === 0 ? -1 : i === 2 ? 1 : 0
  }
  const cx = Math.max(-a, Math.min(a, px))
  const cy = Math.max(-b, Math.min(b, py))
  const angle = Math.atan2(vy, vx)
  const k = arc / (Math.PI / 2) // longueur d'arc par radian
  let s: number
  if (vx === 0 && vy < 0) s = cx >= 0 ? cx : perimetre + cx
  else if (vy === 0 && vx > 0) s = a + arc + (cy + b)
  else if (vx === 0 && vy > 0) s = a + 2 * arc + 2 * b + (a - cx)
  else if (vy === 0 && vx < 0) s = 3 * a + 3 * arc + 2 * b + (b - cy)
  else if (vx > 0 && vy < 0) s = a + k * (angle + Math.PI / 2)
  else if (vx > 0) s = a + arc + 2 * b + k * angle
  else if (vy > 0) s = 3 * a + 2 * arc + 2 * b + k * (angle - Math.PI / 2)
  else s = 3 * a + 3 * arc + 4 * b + k * (angle + Math.PI)
  const tour = perimetre > 0 ? (((s / perimetre) % 1) + 1) % 1 : 0
  return { tour, distance }
}

/** Une zone d'un canvas peinte d'un seul `putImageData`, et les pixels du bord qu'elle contient. */
type Zone = {
  x: number
  y: number
  image: ImageData
  /** Par pixel peint : sa place dans `image.data` (octets), son echantillon du tour, ses poids. */
  octet: Uint32Array
  echantillon: Uint32Array
  /** Anneau : sa part du pixel, et sa ligne de texture (1 a 3, decimale). */
  poidsAnneau: Float32Array
  ligneAnneau: Float32Array
  /** Lumiere : facteurs de la lueur dehors, du verre (secteur, voisins, part commune), son seuil. */
  lueurDehors: Float32Array
  verreLocal: Float32Array
  verreVoisins20: Float32Array
  verreVoisins40: Float32Array
  verreCommun: Float32Array
  verreSeuil: Float32Array
}

/** La table d'une couche : ce qui ne change qu'avec la taille du bloc. */
export type TableDuBord = {
  couche: 'anneau' | 'lumiere'
  largeur: number
  hauteur: number
  echantillons: number
  zones: Zone[]
}

type FabriqueImage = (largeur: number, hauteur: number) => ImageData

/**
 * Precalcule, pour une couche d'un bloc l x h (px CSS, arrondi `rayon`), chaque pixel utile de son
 * canvas — le bloc plus MARGE de chaque cote, a `pixelsParPx` pixels par px : sa place sur le tour et
 * ses poids. L'anneau ne garde que les pixels du trait ; la lumiere, la lueur dehors et le verre
 * jusqu'a PROFONDEUR_DU_VERRE. `lueur` (0 a 1) attenue la lumiere : la scene 3D l'eteint.
 */
export function tableDuBord(
  couche: 'anneau' | 'lumiere',
  l: number,
  h: number,
  rayon: number,
  pixelsParPx: number,
  lueur: number,
  fabrique: FabriqueImage
): TableDuBord {
  const lc = Math.max(1, Math.round((l + 2 * MARGE) * pixelsParPx))
  const hc = Math.max(1, Math.round((h + 2 * MARGE) * pixelsParPx))
  // Le canvas est etire sur le bloc et ses marges : un pixel couvre exactement ces px CSS.
  const pasX = (l + 2 * MARGE) / lc
  const pasY = (h + 2 * MARGE) / hc
  const echantillons = Math.max(DEGRES, Math.ceil(2 * (l + h) * pixelsParPx))
  const profondeur = couche === 'anneau' ? EPAISSEUR : EPAISSEUR + PROFONDEUR_DU_VERRE + 1
  // Quatre bandes le long des bords (le milieu d'un grand bloc n'est jamais peint) ; un bloc trop
  // petit pour en avoir, une seule zone.
  const e = Math.ceil((MARGE + Math.max(rayon, profondeur) + 1) * pixelsParPx)
  const rects: [number, number, number, number][] =
    hc > 2 * e && lc > 2 * e
      ? [
          [0, 0, lc, e],
          [0, hc - e, lc, e],
          [0, e, e, hc - 2 * e],
          [lc - e, e, e, hc - 2 * e]
        ]
      : [[0, 0, lc, hc]]
  const zones: Zone[] = []
  for (const [zx, zy, zl, zh] of rects) {
    const octet: number[] = []
    const echantillon: number[] = []
    const poidsAnneau: number[] = []
    const ligneAnneau: number[] = []
    const lueurDehors: number[] = []
    const verreLocal: number[] = []
    const verreVoisins20: number[] = []
    const verreVoisins40: number[] = []
    const verreCommun: number[] = []
    const verreSeuil: number[] = []
    for (let j = 0; j < zh; j++) {
      for (let i = 0; i < zl; i++) {
        const x = (zx + i + 0.5) * pasX - MARGE
        const y = (zy + j + 0.5) * pasY - MARGE
        const { tour, distance } = pointDuBord(x, y, l, h, rayon)
        const dedans = -distance
        let wa = 0
        let ho = 0
        let vl = 0
        let v20 = 0
        let v40 = 0
        let vc = 0
        let vs = 0
        if (couche === 'anneau') {
          // Part du pixel dans le trait (bords lisses a l'echelle du pixel).
          const sousLeBord = Math.min(1, Math.max(0, 0.5 - distance * pixelsParPx))
          const horsDuCreux = Math.min(1, Math.max(0, 0.5 - (dedans - EPAISSEUR) * pixelsParPx))
          wa = sousLeBord * horsDuCreux
          if (wa <= 0) continue
        } else {
          if (distance > MARGE || dedans > EPAISSEUR + PROFONDEUR_DU_VERRE + 1) continue
          if (distance >= 0 || dedans < EPAISSEUR / 2) {
            // Dehors (et sous la moitie exterieure du trait) : la lueur, eteinte au bord du canvas.
            const d = Math.max(0, distance)
            ho =
              lueur *
              decroissance(DECROISSANCE_EXTERIEURE, d) *
              Math.min(1, Math.max(0, (MARGE - 0.5 - d) / 3))
          } else {
            // Dedans (et sous la moitie interieure du trait) : le verre, jusqu'au centre du bouton.
            const d = Math.max(0, dedans - EPAISSEUR)
            const fin = Math.min(1, Math.max(0, (PROFONDEUR_DU_VERRE + 1 - d) / 2))
            vl = lueur * decroissance(VERRE_LOCAL, d) * fin
            v20 = lueur * decroissance(VERRE_VOISINS_20, d) * fin
            v40 = lueur * decroissance(VERRE_VOISINS_40, d) * fin
            vc = lueur * decroissance(VERRE_COMMUN, d) * fin
            vs = lueur * decroissance(VERRE_SEUIL, d) * fin * 255
          }
          if (ho < 0.002 && Math.max(vl, v20, v40, vc) < 0.002) continue
        }
        octet.push((j * zl + i) * 4)
        echantillon.push(Math.min(echantillons - 1, Math.floor(tour * echantillons)))
        poidsAnneau.push(wa)
        // Tiers de l'anneau : 0,5 px sous le bord = le tiers exterieur (ligne 3), 2,5 px = interieur.
        ligneAnneau.push(ANNEAU_EXTERIEUR - Math.min(2, Math.max(0, dedans - 0.5)))
        lueurDehors.push(ho)
        verreLocal.push(vl)
        verreVoisins20.push(v20)
        verreVoisins40.push(v40)
        verreCommun.push(vc)
        verreSeuil.push(vs)
      }
    }
    zones.push({
      x: zx,
      y: zy,
      image: fabrique(zl, zh),
      octet: Uint32Array.from(octet),
      echantillon: Uint32Array.from(echantillon),
      poidsAnneau: Float32Array.from(poidsAnneau),
      ligneAnneau: Float32Array.from(ligneAnneau),
      lueurDehors: Float32Array.from(lueurDehors),
      verreLocal: Float32Array.from(verreLocal),
      verreVoisins20: Float32Array.from(verreVoisins20),
      verreVoisins40: Float32Array.from(verreVoisins40),
      verreCommun: Float32Array.from(verreCommun),
      verreSeuil: Float32Array.from(verreSeuil)
    })
  }
  return { couche, largeur: lc, hauteur: hc, echantillons, zones }
}

/**
 * L'eclat moyen de l'anneau (tiers du milieu, RGB 0 a 255) de chaque image de la texture : la source
 * de la part commune du verre. `VERRE_COMMUN` a ete ajuste sur la moyenne du canal le PLUS lumineux
 * de chaque degre : la couleur moyenne est remise a cette force (une moyenne canal par canal la
 * sous-estimait la ou l'anneau est colore, et le verre profond restait trop sombre).
 */
export function eclatsMoyens(texture: Uint8ClampedArray): Float32Array {
  const eclats = new Float32Array(IMAGES * 3)
  for (let i = 0; i < IMAGES; i++) {
    const base = (i * LIGNES + ANNEAU_MILIEU) * DEGRES * 4
    let force = 0
    const moyenne = [0, 0, 0]
    for (let d = 0; d < DEGRES; d++) {
      const o = base + d * 4
      force += Math.max(texture[o], texture[o + 1], texture[o + 2]) / DEGRES
      for (let c = 0; c < 3; c++) moyenne[c] += texture[o + c] / DEGRES
    }
    const plusFort = Math.max(...moyenne)
    for (let c = 0; c < 3; c++)
      eclats[i * 3 + c] = plusFort > 0 ? (moyenne[c] * force) / plusFort : 0
  }
  return eclats
}

/**
 * La texture telle qu'elle est rejouee : ses 5 lignes par image, puis la lueur dedans moyennee sur
 * chaque VOISINAGE (moyenne glissante sur le tour, qui boucle). Calculee une fois au chargement.
 */
export function avecLesVoisins(texture: Uint8ClampedArray): Uint8ClampedArray {
  const sortie = new Uint8ClampedArray(IMAGES * LIGNES_REJOUEES * DEGRES * 4)
  for (let i = 0; i < IMAGES; i++) {
    sortie.set(
      texture.subarray(i * LIGNES * DEGRES * 4, (i + 1) * LIGNES * DEGRES * 4),
      i * LIGNES_REJOUEES * DEGRES * 4
    )
    const dedans = (i * LIGNES + LUEUR_DEDANS) * DEGRES * 4
    VOISINAGES.forEach((demi, v) => {
      const ligne = (i * LIGNES_REJOUEES + LIGNES + v) * DEGRES * 4
      for (let c = 0; c < 4; c++) {
        if (c === 3) {
          for (let d = 0; d < DEGRES; d++) sortie[ligne + d * 4 + 3] = 255
          continue
        }
        let somme = 0
        for (let k = -demi; k <= demi; k++)
          somme += texture[dedans + (((k % DEGRES) + DEGRES) % DEGRES) * 4 + c]
        for (let d = 0; d < DEGRES; d++) {
          sortie[ligne + d * 4 + c] = somme / (2 * demi + 1)
          const sort = (((d - demi) % DEGRES) + DEGRES) % DEGRES
          const entre = (d + demi + 1) % DEGRES
          somme += texture[dedans + entre * 4 + c] - texture[dedans + sort * 4 + c]
        }
      }
    })
  }
  return sortie
}

/** Tout ce qu'il faut pour peindre une image : texture rejouee, eclats moyens, couleur du fond. */
export type Source = {
  /** La texture rejouee (`avecLesVoisins`) : LIGNES_REJOUEES lignes par image. */
  texture: Uint8ClampedArray
  eclats: Float32Array
  /** Le fond sur lequel la lumiere s'ajoute (RGB 0 a 255) : `--bg-0` du theme. */
  fond: readonly [number, number, number]
}

/**
 * Peint la couche a la place `position` de la video (decimale : les deux images voisines sont
 * melangees). Le tour est d'abord echantillonne une fois, puis chaque pixel lit son echantillon.
 */
export function peindre(
  table: TableDuBord,
  source: Source,
  position: number,
  tampon?: Float32Array
): Float32Array {
  const { texture, eclats, fond } = source
  const n = table.echantillons
  const pas = LIGNES_REJOUEES * 3
  const tour = tampon && tampon.length === n * pas ? tampon : new Float32Array(n * pas)
  const i0 = Math.floor(position) % IMAGES
  const i1 = (i0 + 1) % IMAGES
  const m = position - Math.floor(position)
  const base0 = i0 * LIGNES_REJOUEES * DEGRES
  const base1 = i1 * LIGNES_REJOUEES * DEGRES
  for (let k = 0; k < n; k++) {
    const colonne = ((k + 0.5) / n) * DEGRES - 0.5
    const c0 = Math.floor(colonne)
    const f = colonne - c0
    const g0 = (c0 + DEGRES) % DEGRES
    const g1 = (c0 + 1) % DEGRES
    for (let ligne = 0; ligne < LIGNES_REJOUEES; ligne++) {
      const a0 = (base0 + ligne * DEGRES + g0) * 4
      const a1 = (base0 + ligne * DEGRES + g1) * 4
      const b0 = (base1 + ligne * DEGRES + g0) * 4
      const b1 = (base1 + ligne * DEGRES + g1) * 4
      const o = k * pas + ligne * 3
      for (let c = 0; c < 3; c++) {
        const va = texture[a0 + c] + (texture[a1 + c] - texture[a0 + c]) * f
        const vb = texture[b0 + c] + (texture[b1 + c] - texture[b0 + c]) * f
        tour[o + c] = va + (vb - va) * m
      }
    }
  }
  const er = eclats[i0 * 3] + (eclats[i1 * 3] - eclats[i0 * 3]) * m
  const eg = eclats[i0 * 3 + 1] + (eclats[i1 * 3 + 1] - eclats[i0 * 3 + 1]) * m
  const eb = eclats[i0 * 3 + 2] + (eclats[i1 * 3 + 2] - eclats[i0 * 3 + 2]) * m
  for (const zone of table.zones) {
    const d = zone.image.data
    const { octet, echantillon } = zone
    if (table.couche === 'anneau') {
      const { poidsAnneau, ligneAnneau } = zone
      for (let p = 0; p < octet.length; p++) {
        const s = echantillon[p] * pas
        const ligne = ligneAnneau[p]
        const l0 = Math.floor(ligne)
        const fl = ligne - l0
        const a0 = s + l0 * 3
        const a1 = s + Math.min(ANNEAU_EXTERIEUR, l0 + 1) * 3
        const o = octet[p]
        d[o] = tour[a0] + (tour[a1] - tour[a0]) * fl
        d[o + 1] = tour[a0 + 1] + (tour[a1 + 1] - tour[a0 + 1]) * fl
        d[o + 2] = tour[a0 + 2] + (tour[a1 + 2] - tour[a0 + 2]) * fl
        d[o + 3] = poidsAnneau[p] * 255
      }
      continue
    }
    const { lueurDehors, verreLocal, verreVoisins20, verreVoisins40, verreCommun, verreSeuil } =
      zone
    for (let p = 0; p < octet.length; p++) {
      const s = echantillon[p] * pas
      const ho = lueurDehors[p]
      const vl = verreLocal[p]
      const v20 = verreVoisins20[p]
      const v40 = verreVoisins40[p]
      const vc = verreCommun[p]
      const vs = verreSeuil[p]
      // La lumiere ajoutee (0 a 255) : lueur dehors, ou verre (secteur, voisins, part commune, seuil).
      const lumiere = (c: number, eclat: number): number =>
        Math.max(
          0,
          tour[s + LUEUR_DEHORS * 3 + c] * ho +
            tour[s + LUEUR_DEDANS * 3 + c] * vl +
            tour[s + VOISINS_20 * 3 + c] * v20 +
            tour[s + VOISINS_40 * 3 + c] * v40 +
            eclat * vc +
            vs
        )
      const lr = lumiere(0, er)
      const lv = lumiere(1, eg)
      const lb = lumiere(2, eb)
      // Une lumiere AJOUTEE : son alpha est sa force, sa couleur le fond plus ce qu'elle apporte
      // (plafonnee au blanc). Sur un fond noir, cela donne fond + lumiere ; sur le fond clair, une
      // lueur a peine visible, jamais teintee ; sur l'anneau noir d'un bloc voisin, qu'elle deborde,
      // un trait eclairci. Un alpha tire de la marge restant jusqu'au blanc devenait opaque en theme
      // clair et effacait l'anneau des voisins (film du 2026-11-13 : ecart au pin de 7 a 21).
      const alpha = Math.min(1, Math.max(lr, lv, lb) / 255)
      const o = octet[p]
      if (alpha <= 0.002) {
        d[o + 3] = 0
        continue
      }
      d[o] = fond[0] + lr / alpha
      d[o + 1] = fond[1] + lv / alpha
      d[o + 2] = fond[2] + lb / alpha
      d[o + 3] = alpha * 255
    }
  }
  return tour
}

/** Une couleur CSS calculee (`#rgb`, `#rrggbb`, `rgb()`, `rgba()`) en RGB 0 a 255 ; noir sinon. */
export function couleurRgb(texte: string): [number, number, number] {
  const t = texte.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(t)
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1]
    return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
  }
  const rgb = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(t)
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])]
  return [0, 0, 0]
}

/* ------------------------------------------------------------------------------------------------
   Le branchement dans la page : une texture chargee une fois, une seule boucle pour tous les blocs.
   ------------------------------------------------------------------------------------------------ */

let texture: Uint8ClampedArray | null = null
let eclats: Float32Array | null = null
let chargement: Promise<void> | null = null

function chargerLaTexture(): Promise<void> {
  chargement ??= (async () => {
    const img = new Image()
    img.src = urlDeLaTexture
    await img.decode()
    const toile = document.createElement('canvas')
    toile.width = DEGRES
    toile.height = IMAGES * LIGNES
    const ctx = toile.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.drawImage(img, 0, 0)
    const brute = ctx.getImageData(0, 0, DEGRES, IMAGES * LIGNES).data
    eclats = eclatsMoyens(brute)
    texture = avecLesVoisins(brute)
  })().catch(() => {
    // Sans texture, l'anneau noir de la feuille reste seul : rien a peindre.
    chargement = null
  })
  return chargement
}

type Couche = {
  canvas: HTMLCanvasElement
  ctx: CanvasRenderingContext2D | null
  table: TableDuBord | null
  tampon: Float32Array | undefined
}

type Reflet = {
  conteneur: HTMLElement
  anneau: Couche
  lumiere: Couche
  taille: { l: number; h: number; dpr: number } | null
  fond: [number, number, number]
  decalage: number
  /** Taille, arrondi ou theme changes : les tables sont a refaire. */
  aPreparer: boolean
  preparee: number
  peinte: number
  aRepeindre: boolean
}

/**
 * Une table coute 10 a 25 ms (mesure sur un bloc de 720 px) : un bloc qui grandit pendant qu'un
 * texte arrive n'en refait qu'une tous les ESPACEMENT_DES_TABLES_MS ; entre deux, le navigateur
 * etire l'image precedente a la nouvelle taille.
 */
const ESPACEMENT_DES_TABLES_MS = 200

const tous = new Set<Reflet>()
const aLEcran = new Set<Reflet>()
const parConteneur = new WeakMap<Element, Reflet>()
let boucle = 0
let observateurDeChamp: IntersectionObserver | null = null
let observateurDeTaille: ResizeObserver | null = null
let observateurDeTheme: MutationObserver | null = null

/** La place d'un element dans la page, hors defilement (somme des `offsetLeft/Top`). */
function placeDansLaPage(element: HTMLElement): { x: number; y: number } {
  let x = 0
  let y = 0
  for (let e: HTMLElement | null = element; e; e = e.offsetParent as HTMLElement | null) {
    x += e.offsetLeft
    y += e.offsetTop
  }
  return { x, y }
}

/** Le decalage sur la video du bloc qui porte ce reflet (voir `decalageDe`). */
export function decalageDuBloc(conteneur: HTMLElement): number {
  const { x, y } = placeDansLaPage(conteneur)
  return decalageDe(x, y)
}

function preparerLaCouche(
  couche: Couche,
  quoi: 'anneau' | 'lumiere',
  t: { l: number; h: number; dpr: number },
  rayon: number,
  lueur: number
): void {
  couche.ctx ??= couche.canvas.getContext('2d')
  const ctx = couche.ctx
  if (!ctx) return
  const pixelsParPx = quoi === 'anneau' ? t.dpr : 1 / ECHELLE_LUEUR
  couche.table = tableDuBord(quoi, t.l, t.h, rayon, pixelsParPx, lueur, (zl, zh) =>
    ctx.createImageData(zl, zh)
  )
  couche.canvas.width = couche.table.largeur
  couche.canvas.height = couche.table.hauteur
}

function preparer(reflet: Reflet): void {
  const { conteneur, taille } = reflet
  if (!taille) return
  const style = getComputedStyle(conteneur)
  const rayon = Number.parseFloat(style.getPropertyValue('--cadre-rayon')) || 16
  const lueurLue = Number.parseFloat(style.getPropertyValue('--reflet-lueur'))
  const lueur = Number.isFinite(lueurLue) ? lueurLue : 1
  reflet.fond = couleurRgb(style.getPropertyValue('--bg-0'))
  reflet.decalage = decalageDuBloc(conteneur)
  preparerLaCouche(reflet.anneau, 'anneau', taille, rayon, lueur)
  preparerLaCouche(reflet.lumiere, 'lumiere', taille, rayon, lueur)
  reflet.aRepeindre = true
  reflet.aPreparer = false
}

function tic(maintenant: number): void {
  boucle = 0
  if (aLEcran.size === 0) return
  if (texture && eclats) {
    for (const reflet of aLEcran) {
      if (
        reflet.aPreparer &&
        (!reflet.anneau.table || maintenant - reflet.preparee >= ESPACEMENT_DES_TABLES_MS)
      ) {
        preparer(reflet)
        reflet.preparee = maintenant
      }
      if (!reflet.aRepeindre && maintenant - reflet.peinte < ECART_DES_PEINTURES_MS) continue
      const position = positionA(maintenant, reflet.decalage)
      const source: Source = { texture, eclats, fond: reflet.fond }
      for (const couche of [reflet.lumiere, reflet.anneau]) {
        const { table, ctx } = couche
        if (!table || !ctx) continue
        couche.tampon = peindre(table, source, position, couche.tampon)
        for (const zone of table.zones) ctx.putImageData(zone.image, zone.x, zone.y)
      }
      reflet.peinte = maintenant
      reflet.aRepeindre = false
    }
  }
  boucle = requestAnimationFrame(tic)
}

function relancer(): void {
  if (boucle === 0 && aLEcran.size > 0) boucle = requestAnimationFrame(tic)
}

/**
 * Branche le reflet sur son conteneur `.cadre-reflet` (deux canvas : la lumiere, puis l'anneau) :
 * suivi de sa taille et du theme, peint seulement a l'ecran. Rend de quoi le debrancher. Sans
 * IntersectionObserver ni ResizeObserver (jsdom), ne fait rien.
 */
export function brancherLeReflet(conteneur: HTMLElement): () => void {
  if (typeof IntersectionObserver === 'undefined' || typeof ResizeObserver === 'undefined')
    return () => undefined
  const lumiere = conteneur.querySelector<HTMLCanvasElement>('.cadre-reflet__lumiere')
  const anneau = conteneur.querySelector<HTMLCanvasElement>('.cadre-reflet__anneau')
  if (!lumiere || !anneau) return () => undefined
  void chargerLaTexture()
  const couche = (canvas: HTMLCanvasElement): Couche => ({
    canvas,
    ctx: null,
    table: null,
    tampon: undefined
  })
  const reflet: Reflet = {
    conteneur,
    anneau: couche(anneau),
    lumiere: couche(lumiere),
    taille: null,
    fond: [0, 0, 0],
    decalage: 0,
    aPreparer: true,
    preparee: 0,
    peinte: 0,
    aRepeindre: true
  }
  parConteneur.set(conteneur, reflet)
  tous.add(reflet)
  observateurDeChamp ??= new IntersectionObserver((entrees) => {
    for (const entree of entrees) {
      const r = parConteneur.get(entree.target)
      if (!r) continue
      if (entree.isIntersecting) {
        aLEcran.add(r)
        r.aRepeindre = true
      } else aLEcran.delete(r)
    }
    relancer()
  })
  observateurDeTaille ??= new ResizeObserver((entrees) => {
    for (const entree of entrees) {
      const r = parConteneur.get(entree.target)
      if (!r) continue
      const dpr = window.devicePixelRatio || 1
      const l = entree.contentRect.width - 2 * MARGE
      const h = entree.contentRect.height - 2 * MARGE
      if (l <= 0 || h <= 0) continue
      if (r.taille && r.taille.l === l && r.taille.h === h && r.taille.dpr === dpr) continue
      r.taille = { l, h, dpr }
      r.aPreparer = true
    }
    relancer()
  })
  // Un changement de theme change le fond sous la lumiere : toutes les tables sont a refaire.
  if (!observateurDeTheme) {
    observateurDeTheme = new MutationObserver(() => {
      for (const r of tous) r.aPreparer = true
      relancer()
    })
    observateurDeTheme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-base']
    })
  }
  observateurDeChamp.observe(conteneur)
  observateurDeTaille.observe(conteneur)
  return () => {
    observateurDeChamp?.unobserve(conteneur)
    observateurDeTaille?.unobserve(conteneur)
    aLEcran.delete(reflet)
    tous.delete(reflet)
    parConteneur.delete(conteneur)
  }
}
