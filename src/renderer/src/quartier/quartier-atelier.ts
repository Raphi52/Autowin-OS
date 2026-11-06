/**
 * L'ATELIER DES RUNS : au poste « runs », devant le grand robot du hangar, les agents
 * jouaient leur geste `ma` (pattes au museau, puis poussées en avant) dans le vide.
 *
 * Ce qu'on dessine, à l'échelle réelle de la scène (un agent y mesure ~60 px de peinture) :
 *  - chacun a une petite ENCLUME sur un billot, juste là où tombe sa tête de maillet : elle tient
 *    dans la place d'un poste (les quatre postes sont à 30-48 px l'un de l'autre) ;
 *  - le MAILLET est collé à la patte, image par image : le sprite saute d'une image à l'autre, le
 *    maillet aussi. Centres de patte mesurés sur la rangée `ma` des deux atlas (tanuki et renard ont
 *    la même grille) : au museau sur les images 0 à 3, d'un bloc en avant sur 4 et 5 ;
 *  - chaque coup fait jaillir des étincelles et envoie une ÉTINCELLE D'ÉNERGIE dans le cœur du grand
 *    robot. Il se charge (yeux, voyants, cœur) ; à pleine charge, il S'ÉVEILLE : yeux qui flambent,
 *    onde de choc, éclairs sur la carcasse, vapeur aux épaules. Puis la charge repart de zéro.
 * Les points du robot sont mesurés sur `falaise.avif` (peinture de 1344×768). Tout est dessiné par le
 * code : aucune image de plus à charger. Couleurs fixes : c'est du décor peint.
 */

export interface PoseAtelier {
  id: string
  x: number
  y: number
  /** Hauteur de l'agent à l'écran, en pixels de la peinture. */
  u: number
  /** Temps passé à son poste, entrée finie, en secondes. */
  th: number
  /** Le côté vers lequel il travaille : 1 = droite, -1 = gauche (image miroir). */
  sens: number
  /** Durée d'un cycle du geste et son nombre d'images : le maillet suit l'horloge du sprite. */
  cycle: number
  images: number
  alpha: number
}

/** L'image du geste où les pattes partent en avant : le coup tombe là. */
const IMAGE_COUP = 4
/** Le vol d'une étincelle d'énergie, de l'enclume au cœur du robot. */
const VOL_S = 0.85
/**
 * Étincelles reçues pour que le robot s'éveille, et la durée de son réveil. Un agent en envoie 1,5 par
 * seconde : seul, il réveille le robot toutes les 20 s ; à quatre, toutes les 8 s environ.
 */
const CHARGE_PLEINE = 30
const REVEIL_S = 2.8

/** Le grand robot du hangar, mesuré sur la peinture. */
const ROBOT = {
  yeux: { x: 218, y: 461 },
  voyants: [
    { x: 210, y: 481 },
    { x: 231, y: 479 }
  ],
  coeur: { x: 225, y: 497 },
  epaules: [
    { x: 186, y: 467 },
    { x: 247, y: 457 }
  ],
  /** Où courent les éclairs du réveil. */
  carcasse: [
    { x: 186, y: 469 },
    { x: 248, y: 458 },
    { x: 257, y: 486 },
    { x: 190, y: 505 },
    { x: 205, y: 525 },
    { x: 237, y: 527 },
    { x: 225, y: 497 },
    { x: 218, y: 462 }
  ]
} as const

function hasard(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

interface Etat {
  /** Coups déjà donnés depuis l'arrivée. */
  coup: number
  /** Temps depuis le dernier coup, en secondes (grand s'il n'y en a pas eu). */
  depuis: number
  /** Image courante du geste. */
  image: number
}

function etat(p: PoseAtelier): Etat {
  const image = Math.floor((p.th * p.images) / p.cycle) % p.images
  const tCoup = (IMAGE_COUP / p.images) * p.cycle
  const coup = Math.max(0, Math.floor((p.th - tCoup) / p.cycle) + 1)
  const depuis = coup > 0 ? p.th - (tCoup + (coup - 1) * p.cycle) : 99
  return { coup, depuis, image }
}

/** Le point de frappe, dans le repère de l'agent tourné vers la droite. */
const FRAPPE = { x: 0.53, y: -0.4 }

/** Le billot et l'enclume, dessinés AVANT l'agent. */
function etabliForge(x: CanvasRenderingContext2D, p: PoseAtelier): void {
  const { u } = p
  const e = etat(p)
  x.save()
  x.globalAlpha = p.alpha
  x.translate(p.x, p.y)
  x.scale(p.sens, 1)
  const cx = FRAPPE.x * u
  const haut = -0.31 * u
  // Ombre au sol.
  x.fillStyle = 'rgba(50,30,20,.3)' // couleur-fixe: ombre portée sur la peinture
  x.beginPath()
  x.ellipse(cx, 0, u * 0.11, u * 0.03, 0, 0, Math.PI * 2)
  x.fill()
  // Le billot : un rondin, cerné de clair en haut.
  const g = x.createLinearGradient(cx - u * 0.06, 0, cx + u * 0.06, 0)
  g.addColorStop(0, '#6e4528') // couleur-fixe: bois du billot, côté ombre
  g.addColorStop(0.5, '#9c6a40') // couleur-fixe: bois du billot, lumière
  g.addColorStop(1, '#5e3a22') // couleur-fixe: bois du billot, bord
  x.fillStyle = g
  x.fillRect(cx - u * 0.065, haut + u * 0.02, u * 0.13, -haut - u * 0.02)
  x.fillStyle = '#c99a6a' // couleur-fixe: dessus du billot
  x.beginPath()
  x.ellipse(cx, haut + u * 0.02, u * 0.065, u * 0.018, 0, 0, Math.PI * 2)
  x.fill()
  // L'enclume : une silhouette lisible même à dix pixels.
  const a = haut + u * 0.015
  x.fillStyle = '#3d424b' // couleur-fixe: acier de l'enclume
  x.beginPath()
  x.moveTo(cx - u * 0.04, a)
  x.lineTo(cx + u * 0.04, a)
  x.lineTo(cx + u * 0.03, a - u * 0.03)
  x.lineTo(cx + u * 0.1, a - u * 0.045)
  x.lineTo(cx + u * 0.06, a - u * 0.065)
  x.lineTo(cx - u * 0.09, a - u * 0.065)
  x.lineTo(cx - u * 0.03, a - u * 0.03)
  x.closePath()
  x.fill()
  x.fillStyle = '#9aa2ad' // couleur-fixe: arête claire de l'enclume
  x.fillRect(cx - u * 0.09, a - u * 0.068, u * 0.15, u * 0.01)
  // La pièce sur l'enclume : blanche au coup, elle refroidit vers l'orange puis le rouge sombre.
  const chaud = Math.max(0, 1 - e.depuis / 1.1)
  const r = 150 + 105 * Math.min(1, chaud * 1.4)
  const v = 60 + 170 * chaud * chaud
  const b = 30 + 160 * chaud ** 4
  x.fillStyle = `rgb(${r | 0},${v | 0},${b | 0})` // couleur-fixe: métal chauffé qui refroidit
  x.fillRect(cx - u * 0.035, a - u * 0.082, u * 0.07, u * 0.016)
  x.globalCompositeOperation = 'lighter'
  const l = 0.25 + 0.6 * chaud
  const halo = x.createRadialGradient(cx, a - u * 0.075, 0, cx, a - u * 0.075, u * 0.2)
  halo.addColorStop(0, `rgba(255,140,40,${l})`) // couleur-fixe: lueur de forge
  halo.addColorStop(1, 'rgba(255,80,0,0)') // couleur-fixe: lueur de forge, bord
  x.fillStyle = halo
  x.fillRect(cx - u * 0.2, a - u * 0.275, u * 0.4, u * 0.4)
  x.restore()
}

/** Le maillet dans la patte, les étincelles et l'énergie envoyée au robot : APRÈS l'agent. */
function outilForge(x: CanvasRenderingContext2D, p: PoseAtelier): void {
  const { u, sens } = p
  const e = etat(p)
  x.save()
  x.globalAlpha = p.alpha
  x.translate(p.x, p.y)
  x.scale(sens, 1)

  // Collé à la patte : au museau, maillet dressé ; patte tendue, il est à plat sur l'enclume.
  const tendu = e.image >= IMAGE_COUP
  const hx = (tendu ? 0.305 : 0.163) * u
  const hy = (tendu ? -0.41 : -0.518) * u
  const rebond = tendu && e.depuis < 0.1 ? -0.12 * Math.sin((e.depuis / 0.1) * Math.PI) : 0
  x.save()
  x.translate(hx, hy)
  x.rotate((tendu ? 0.02 : -1.6) + rebond)
  x.strokeStyle = '#a8703f' // couleur-fixe: manche en bois du maillet
  x.lineWidth = Math.max(1, u * 0.024)
  x.lineCap = 'round'
  x.beginPath()
  x.moveTo(-u * 0.03, 0)
  x.lineTo(u * 0.19, 0)
  x.stroke()
  x.fillStyle = '#4c525c' // couleur-fixe: tête d'acier du maillet
  x.fillRect(u * 0.185, -u * 0.055, u * 0.07, u * 0.11)
  x.fillStyle = '#a7afba' // couleur-fixe: face de frappe du maillet, polie
  x.fillRect(u * 0.245, -u * 0.055, u * 0.012, u * 0.11)
  x.restore()

  const fx = FRAPPE.x * u
  const fy = FRAPPE.y * u + u * 0.02
  x.globalCompositeOperation = 'lighter'
  // L'éclair du contact.
  if (e.depuis < 0.09) {
    const k = 1 - e.depuis / 0.09
    const g = x.createRadialGradient(fx, fy, 0, fx, fy, u * 0.2 * (0.6 + k))
    g.addColorStop(0, `rgba(255,250,225,${k})`) // couleur-fixe: éclair du coup de maillet
    g.addColorStop(1, 'rgba(255,170,60,0)') // couleur-fixe: éclair du coup, bord
    x.fillStyle = g
    x.fillRect(fx - u * 0.35, fy - u * 0.35, u * 0.7, u * 0.7)
  }
  // La gerbe : des traits qui partent en éventail et retombent, stables d'une image à l'autre.
  const vie = 0.6
  if (e.coup > 0 && e.depuis < vie) {
    const t = e.depuis
    for (let i = 0; i < 18; i++) {
      const r1 = hasard(e.coup * 31 + i + p.x)
      const r2 = hasard(e.coup * 57 + i * 3 + p.y)
      const ang = -Math.PI / 2 + (r1 - 0.35) * 2.8
      const v = u * (0.8 + r2 * 1.8)
      const sx = fx + Math.cos(ang) * v * t
      const sy = fy + Math.sin(ang) * v * t + 3 * u * t * t
      const k = 1 - t / vie
      x.strokeStyle = `rgba(255,${(170 + 80 * k) | 0},${(60 + 120 * k * k) | 0},${k})` // couleur-fixe: étincelle
      x.lineWidth = Math.max(0.8, u * 0.016)
      x.lineCap = 'round'
      x.beginPath()
      x.moveTo(sx, sy)
      x.lineTo(sx - Math.cos(ang) * u * 0.09 * k, sy - Math.sin(ang) * u * 0.09 * k + u * 0.02)
      x.stroke()
    }
  }
  x.restore()

  energie(x, p, e, fx, fy, 'or')
}

/**
 * LES MÉTIERS DE L'ATELIER : un agent au poste des runs ne fait pas que forger. Il passe
 * d'un travail à l'autre — forge, soudure, ordinateur, robotique —, tiré de son id et changé toutes
 * les 30 s, pour que deux voisins ne fassent pas la même chose au même moment. Le geste du sprite ne
 * change pas : seul ce qu'il tient et ce qu'il y a devant lui change. Chaque coup charge le robot.
 */
export type Travail = 'forge' | 'soudure' | 'ordinateur' | 'robotique'
const TRAVAUX: readonly Travail[] = ['forge', 'soudure', 'ordinateur', 'robotique']
/** Le temps passé sur un même travail avant d'en changer. */
export const TRAVAIL_S = 30

function graineDe(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 100003
  return h
}

/** Le travail d'un agent à cet instant : jamais deux fois de suite le même. */
export function travailDe(p: Pick<PoseAtelier, 'id' | 'th'>): Travail {
  const g = graineDe(p.id)
  const tranche = Math.floor(Math.max(0, p.th) / TRAVAIL_S)
  let i = Math.floor(hasard(g) * TRAVAUX.length)
  for (let k = 1; k <= tranche; k++) i = (i + 1 + Math.floor(hasard(g + k * 13) * 3)) % 4
  return TRAVAUX[i]
}

/** Le billot commun : un rondin cerné de clair en haut, son ombre au sol. */
function billot(x: CanvasRenderingContext2D, u: number, cx: number, haut: number): void {
  x.fillStyle = 'rgba(50,30,20,.3)' // couleur-fixe: ombre portée sur la peinture
  x.beginPath()
  x.ellipse(cx, 0, u * 0.11, u * 0.03, 0, 0, Math.PI * 2)
  x.fill()
  const g = x.createLinearGradient(cx - u * 0.06, 0, cx + u * 0.06, 0)
  g.addColorStop(0, '#6e4528') // couleur-fixe: bois du billot, côté ombre
  g.addColorStop(0.5, '#9c6a40') // couleur-fixe: bois du billot, lumière
  g.addColorStop(1, '#5e3a22') // couleur-fixe: bois du billot, bord
  x.fillStyle = g
  x.fillRect(cx - u * 0.065, haut + u * 0.02, u * 0.13, -haut - u * 0.02)
  x.fillStyle = '#c99a6a' // couleur-fixe: dessus du billot
  x.beginPath()
  x.ellipse(cx, haut + u * 0.02, u * 0.065, u * 0.018, 0, 0, Math.PI * 2)
  x.fill()
}

function lueurRonde(
  x: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  coeur: string,
  bord: string
): void {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
  g.addColorStop(0, coeur)
  g.addColorStop(1, bord)
  x.fillStyle = g
  x.fillRect(cx - r, cy - r, r * 2, r * 2)
}

/** Soudure : une plaque d'acier sur le billot, et la ligne de soudure qui rougeoie derrière l'arc. */
function etabliSoudure(x: CanvasRenderingContext2D, p: PoseAtelier): void {
  const { u } = p
  const cx = FRAPPE.x * u
  const haut = -0.31 * u
  billot(x, u, cx, haut)
  const a = haut + u * 0.01
  x.fillStyle = '#59606b' // couleur-fixe: plaque d'acier
  x.fillRect(cx - u * 0.08, a - u * 0.03, u * 0.16, u * 0.03)
  x.fillStyle = '#8d96a2' // couleur-fixe: arête de la plaque
  x.fillRect(cx - u * 0.08, a - u * 0.032, u * 0.16, u * 0.006)
  // Le cordon avance au fil des coups puis repart : rouge derrière, blanc à la pointe.
  const e = etat(p)
  const av = ((e.coup % 8) + Math.min(1, e.depuis)) / 8
  const g = x.createLinearGradient(cx - u * 0.07, 0, cx - u * 0.07 + u * 0.14 * av, 0)
  g.addColorStop(0, 'rgba(120,40,20,.9)') // couleur-fixe: cordon de soudure refroidi
  g.addColorStop(1, 'rgba(255,190,90,1)') // couleur-fixe: cordon de soudure chaud
  x.fillStyle = g
  x.fillRect(cx - u * 0.07, a - u * 0.036, u * 0.14 * av, u * 0.008)
}

/** Ordinateur : une caisse en guise de bureau, un portable ouvert dont l'écran éclaire l'agent. */
function etabliOrdinateur(x: CanvasRenderingContext2D, p: PoseAtelier): void {
  const { u } = p
  const cx = FRAPPE.x * u
  const haut = -0.33 * u
  x.fillStyle = 'rgba(50,30,20,.3)' // couleur-fixe: ombre portée sur la peinture
  x.beginPath()
  x.ellipse(cx, 0, u * 0.13, u * 0.03, 0, 0, Math.PI * 2)
  x.fill()
  x.fillStyle = '#8a5a34' // couleur-fixe: caisse en bois
  x.fillRect(cx - u * 0.1, haut, u * 0.2, -haut)
  x.fillStyle = '#6a4226' // couleur-fixe: planches de la caisse
  x.fillRect(cx - u * 0.1, haut + u * 0.1, u * 0.2, u * 0.012)
  x.fillRect(cx - u * 0.1, haut + u * 0.21, u * 0.2, u * 0.012)
  // Le portable : clavier à plat, écran ouvert du côté opposé à l'agent, tourné vers lui.
  x.fillStyle = '#2b2f36' // couleur-fixe: coque du portable
  x.fillRect(cx - u * 0.07, haut - u * 0.012, u * 0.13, u * 0.012)
  x.save()
  x.translate(cx + u * 0.06, haut - u * 0.012)
  x.rotate(-0.25)
  x.fillRect(-u * 0.012, -u * 0.11, u * 0.012, u * 0.11)
  // L'écran vu de biais : un liseré lumineux et des lignes de code qui défilent.
  const t = p.th
  x.fillStyle = 'rgba(90,200,255,.95)' // couleur-fixe: écran allumé
  x.fillRect(-u * 0.018, -u * 0.105, u * 0.007, u * 0.1)
  x.restore()
  x.save()
  x.globalCompositeOperation = 'lighter'
  lueurRonde(
    x,
    cx + u * 0.02,
    haut - u * 0.07,
    u * 0.22,
    'rgba(80,170,255,.35)', // couleur-fixe: lueur peinte du décor de l'atelier
    'rgba(40,90,255,0)' // couleur-fixe: lueur peinte du décor de l'atelier
  ) // couleur-fixe: lueur de l'écran
  // Des lignes de code flottent au-dessus de l'écran, montent et s'effacent.
  for (let i = 0; i < 4; i++) {
    const k = (t * 0.6 + i / 4) % 1
    const lg = u * (0.03 + 0.05 * hasard(Math.floor(t * 0.6 + i / 4) * 7 + i))
    x.fillStyle = `rgba(140,230,255,${0.7 * (1 - k)})` // couleur-fixe: ligne de code
    x.fillRect(cx - u * 0.01, haut - u * 0.13 - k * u * 0.14, lg, u * 0.008)
  }
  x.restore()
}

/** Robotique : un petit robot en chantier sur le billot, antenne allumée. */
function etabliRobotique(x: CanvasRenderingContext2D, p: PoseAtelier): void {
  const { u } = p
  const cx = FRAPPE.x * u
  const haut = -0.31 * u
  billot(x, u, cx, haut)
  const e = etat(p)
  const b = haut + u * 0.015
  // Le corps, la tête, l'antenne : un robot de la taille d'une enclume.
  x.fillStyle = '#7a8796' // couleur-fixe: tôle du petit robot
  x.fillRect(cx - u * 0.035, b - u * 0.07, u * 0.07, u * 0.07)
  x.fillStyle = '#9fb0c2' // couleur-fixe: tête du petit robot
  x.fillRect(cx - u * 0.028, b - u * 0.115, u * 0.056, u * 0.045)
  x.strokeStyle = '#4b5562' // couleur-fixe: antenne
  x.lineWidth = Math.max(0.8, u * 0.008)
  x.beginPath()
  x.moveTo(cx, b - u * 0.115)
  x.lineTo(cx, b - u * 0.15)
  x.stroke()
  // Son bras gauche se lève à chaque boulon serré.
  const leve = e.depuis < 0.4 ? Math.sin((e.depuis / 0.4) * Math.PI) : 0
  x.save()
  x.translate(cx - u * 0.035, b - u * 0.06)
  x.rotate(-0.3 - leve * 1.4)
  x.fillStyle = '#7a8796' // couleur-fixe: bras du petit robot
  x.fillRect(-u * 0.05, -u * 0.008, u * 0.05, u * 0.016)
  x.restore()
  // Les yeux et l'antenne clignotent quand il reçoit un coup de clé.
  const vif = e.depuis < 0.3 ? 1 : 0.45 + 0.2 * Math.sin(p.th * 6)
  x.fillStyle = `rgba(120,255,200,${vif})` // couleur-fixe: yeux du petit robot
  x.fillRect(cx - u * 0.018, b - u * 0.1, u * 0.012, u * 0.01)
  x.fillRect(cx + u * 0.006, b - u * 0.1, u * 0.012, u * 0.01)
  x.save()
  x.globalCompositeOperation = 'lighter'
  lueurRonde(
    x,
    cx,
    b - u * 0.152,
    u * 0.04 * (0.6 + vif),
    `rgba(255,90,90,${vif})`, // couleur-fixe: lueur peinte du décor de l'atelier
    'rgba(255,40,40,0)' // couleur-fixe: lueur peinte du décor de l'atelier
  ) // couleur-fixe: voyant d'antenne
  x.restore()
}

/** Le billot et ce qu'il porte, selon le travail du moment : AVANT l'agent. */
export function dessinerEtabli(x: CanvasRenderingContext2D, p: PoseAtelier): void {
  const travail = travailDe(p)
  if (travail === 'forge') return etabliForge(x, p)
  x.save()
  x.globalAlpha = p.alpha
  x.translate(p.x, p.y)
  x.scale(p.sens, 1)
  if (travail === 'soudure') etabliSoudure(x, p)
  else if (travail === 'ordinateur') etabliOrdinateur(x, p)
  else etabliRobotique(x, p)
  x.restore()
}

/** La patte de l'agent à cette image du geste : au museau, ou tendue vers l'établi. */
function patte(p: PoseAtelier, e: Etat): { hx: number; hy: number; tendu: boolean } {
  const tendu = e.image >= IMAGE_COUP
  return { hx: (tendu ? 0.305 : 0.163) * p.u, hy: (tendu ? -0.41 : -0.518) * p.u, tendu }
}

/** Le chalumeau : la flamme bleue, l'arc blanc qui crépite et la pluie d'étincelles. */
function outilSoudure(x: CanvasRenderingContext2D, p: PoseAtelier, e: Etat): void {
  const { u } = p
  const { hx, hy, tendu } = patte(p, e)
  const fx = FRAPPE.x * u
  const fy = FRAPPE.y * u + u * 0.06
  x.save()
  x.translate(hx, hy)
  x.rotate(tendu ? 0.55 : -0.4)
  x.fillStyle = '#c7a24a' // couleur-fixe: laiton du chalumeau
  x.fillRect(-u * 0.02, -u * 0.012, u * 0.12, u * 0.024)
  x.fillStyle = '#3d424b' // couleur-fixe: buse du chalumeau
  x.fillRect(u * 0.1, -u * 0.008, u * 0.05, u * 0.016)
  x.restore()
  if (!tendu) return
  x.save()
  x.globalCompositeOperation = 'lighter'
  const cr = 0.7 + 0.3 * hasard(Math.floor(p.th * 30) + p.x)
  lueurRonde(x, fx, fy, u * 0.28 * cr, 'rgba(235,245,255,.95)', 'rgba(90,150,255,0)') // couleur-fixe: arc de soudure
  lueurRonde(x, fx, fy, u * 0.06, 'rgba(255,255,255,1)', 'rgba(180,220,255,0)') // couleur-fixe: cœur de l'arc
  for (let i = 0; i < 10; i++) {
    const t = (p.th * 2.5 + hasard(i * 9 + p.y)) % 1
    const ang = Math.PI * (0.15 + 0.7 * hasard(i * 17 + Math.floor(p.th * 2.5)))
    const v = u * (0.3 + 0.5 * hasard(i * 5))
    const sx = fx + Math.cos(ang) * v * t * (i % 2 ? 1 : -1)
    const sy = fy - u * 0.05 * t + 2.5 * u * t * t
    x.fillStyle = `rgba(255,${(200 + 55 * (1 - t)) | 0},120,${1 - t})` // couleur-fixe: étincelle de soudure
    x.fillRect(sx, sy, Math.max(1, u * 0.012), Math.max(1, u * 0.012))
  }
  x.restore()
}

/** L'ordinateur : pas d'outil, des touches qui s'allument sous les pattes à chaque frappe. */
function outilOrdinateur(x: CanvasRenderingContext2D, p: PoseAtelier, e: Etat): void {
  const { u } = p
  if (e.depuis > 0.15) return
  const cx = FRAPPE.x * u
  const haut = -0.33 * u
  x.save()
  x.globalCompositeOperation = 'lighter'
  const k = 1 - e.depuis / 0.15
  for (let i = 0; i < 3; i++) {
    const kx = cx - u * 0.06 + u * 0.1 * hasard(e.coup * 11 + i)
    lueurRonde(x, kx, haut - u * 0.014, u * 0.025, `rgba(150,230,255,${k})`, 'rgba(60,150,255,0)') // couleur-fixe: touche frappée
  }
  x.restore()
}

/** La clé à molette : elle serre un boulon à chaque coup, avec une petite étincelle. */
function outilRobotique(x: CanvasRenderingContext2D, p: PoseAtelier, e: Etat): void {
  const { u } = p
  const { hx, hy, tendu } = patte(p, e)
  x.save()
  x.translate(hx, hy)
  x.rotate(tendu ? 0.35 + (e.depuis < 0.2 ? 0.5 * (1 - e.depuis / 0.2) : 0) : -1.2)
  x.strokeStyle = '#a9b2bd' // couleur-fixe: acier de la clé
  x.lineWidth = Math.max(1, u * 0.02)
  x.lineCap = 'round'
  x.beginPath()
  x.moveTo(0, 0)
  x.lineTo(u * 0.17, 0)
  x.stroke()
  x.lineWidth = Math.max(1, u * 0.016)
  x.beginPath()
  x.arc(u * 0.19, 0, u * 0.028, 0.9, Math.PI * 2 - 0.9)
  x.stroke()
  x.restore()
  if (e.coup > 0 && e.depuis < 0.12) {
    x.save()
    x.globalCompositeOperation = 'lighter'
    const k = 1 - e.depuis / 0.12
    lueurRonde(
      x,
      FRAPPE.x * u - u * 0.035,
      -0.31 * u - u * 0.06,
      u * 0.08 * (0.5 + k),
      `rgba(255,240,200,${k})`, // couleur-fixe: lueur peinte du décor de l'atelier
      'rgba(255,170,60,0)' // couleur-fixe: lueur peinte du décor de l'atelier
    ) // couleur-fixe: étincelle du boulon
    x.restore()
  }
}

/** Ce que l'agent tient, et l'énergie qu'il envoie au robot : APRÈS l'agent. */
export function dessinerOutil(x: CanvasRenderingContext2D, p: PoseAtelier): void {
  const travail = travailDe(p)
  if (travail === 'forge') return outilForge(x, p)
  const e = etat(p)
  x.save()
  x.globalAlpha = p.alpha
  x.translate(p.x, p.y)
  x.scale(p.sens, 1)
  if (travail === 'soudure') outilSoudure(x, p, e)
  else if (travail === 'ordinateur') outilOrdinateur(x, p, e)
  else outilRobotique(x, p, e)
  x.restore()
  energie(
    x,
    p,
    e,
    FRAPPE.x * p.u,
    FRAPPE.y * p.u + p.u * 0.02,
    travail === 'ordinateur' ? 'bleu' : 'or'
  )
}

/** Les teintes de l'énergie envoyée au robot : dorée pour le métal, bleue pour le code. */
const TEINTES = {
  or: ['rgba(255,248,210,1)', 'rgba(255,200,90,.9)', 'rgba(255,140,30,0)'], // couleur-fixe: étincelle d'énergie
  bleu: ['rgba(225,250,255,1)', 'rgba(110,210,255,.9)', 'rgba(40,120,255,0)'] // couleur-fixe: paquet de données
} as const

/** L'énergie part au cœur du robot : une boule et sa traîne, en arc par-dessus le hangar. */
function energie(
  x: CanvasRenderingContext2D,
  p: PoseAtelier,
  e: Etat,
  fx: number,
  fy: number,
  teinte: keyof typeof TEINTES
): void {
  const { u } = p
  const c = TEINTES[teinte]
  if (e.coup > 0 && e.depuis < VOL_S) {
    const ox = p.x + p.sens * fx
    const oy = p.y + fy
    const bx = ROBOT.coeur.x
    const by = ROBOT.coeur.y
    const mx = (ox + bx) / 2
    const my = Math.min(oy, by) - 28 - Math.abs(ox - bx) * 0.25
    const pos = (t: number): [number, number] => {
      const s = 1 - t
      return [s * s * ox + 2 * s * t * mx + t * t * bx, s * s * oy + 2 * s * t * my + t * t * by]
    }
    const t = e.depuis / VOL_S
    const lisse = t * t * (3 - 2 * t)
    x.save()
    x.globalCompositeOperation = 'lighter'
    for (let i = 7; i >= 0; i--) {
      const ti = Math.max(0, lisse - i * 0.035)
      const [px, py] = pos(ti)
      const k = 1 - i / 8
      x.globalAlpha = p.alpha * k * 0.85
      const r = Math.max(1, u * 0.05 * k)
      const g = x.createRadialGradient(px, py, 0, px, py, r * 2.2)
      g.addColorStop(0, c[0]) // couleur-fixe: cœur de l'étincelle d'énergie
      g.addColorStop(0.35, c[1]) // couleur-fixe: étincelle d'énergie
      g.addColorStop(1, c[2]) // couleur-fixe: étincelle d'énergie, bord
      x.fillStyle = g
      x.fillRect(px - r * 2.2, py - r * 2.2, r * 4.4, r * 4.4)
    }
    x.restore()
  }
}

/** Le réveil du grand robot : il compte les étincelles reçues de tous les agents de l'atelier. */
export interface RobotDeLAtelier {
  /** Après les agents : compte les étincelles arrivées pendant cette image. */
  avancer(dt: number, poses: readonly PoseAtelier[]): void
  /** Avant les agents : la lumière du robot, sur la peinture. */
  dessiner(x: CanvasRenderingContext2D): void
  /** Sa charge et le temps depuis son réveil (négatif hors réveil), pour les tests. */
  lire(): { charge: number; reveil: number }
}

export function creerRobotDeLAtelier(): RobotDeLAtelier {
  const recues = new Map<string, number>()
  let charge = 0
  /** Le dernier voyant allumé par une arrivée, qui s'éteint en douceur. */
  let eclat = 0
  /** Le temps depuis le réveil ; négatif = pas de réveil en cours. */
  let reveil = -1
  let temps = 0
  /** Le robot s'éteint doucement quand plus personne ne forge. */
  let presence = 0

  const lueur = (
    x: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    r: number,
    coeur: string,
    bord: string
  ): void => {
    if (r <= 0) return
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, coeur)
    g.addColorStop(1, bord)
    x.fillStyle = g
    x.fillRect(cx - r, cy - r, r * 2, r * 2)
  }

  const eclair = (
    x: CanvasRenderingContext2D,
    a: { x: number; y: number },
    b: { x: number; y: number },
    graine: number
  ): void => {
    x.beginPath()
    x.moveTo(a.x, a.y)
    const n = 6
    for (let i = 1; i < n; i++) {
      const t = i / n
      const dx = (hasard(graine + i) - 0.5) * 9
      const dy = (hasard(graine + i * 7) - 0.5) * 9
      x.lineTo(a.x + (b.x - a.x) * t + dx, a.y + (b.y - a.y) * t + dy)
    }
    x.lineTo(b.x, b.y)
    x.stroke()
  }

  return {
    lire: () => ({ charge, reveil }),
    avancer(dt, poses) {
      temps += dt
      eclat = Math.max(0, eclat - dt * 2.2)
      presence += ((poses.length ? 1 : 0) - presence) * Math.min(1, dt * 1.5)
      const vus = new Set<string>()
      for (const p of poses) {
        vus.add(p.id)
        const e = etat(p)
        const arrivees = e.coup - (e.coup > 0 && e.depuis < VOL_S ? 1 : 0)
        const avant = recues.get(p.id)
        recues.set(p.id, arrivees)
        if (avant === undefined || arrivees <= avant) continue
        // Pendant le réveil, les coups ne comptent pas : il ne se rallume pas aussitôt éteint.
        if (reveil < 0) charge += arrivees - avant
        eclat = 1
      }
      for (const id of [...recues.keys()]) if (!vus.has(id)) recues.delete(id)
      if (reveil >= 0) {
        reveil += dt
        if (reveil > REVEIL_S) reveil = -1
      } else if (charge >= CHARGE_PLEINE) {
        charge = 0
        reveil = 0
      }
    },

    dessiner(x) {
      const niveau = charge / CHARGE_PLEINE
      if (presence < 0.01 && reveil < 0) return
      x.save()
      x.globalCompositeOperation = 'lighter'
      const r = reveil >= 0 ? reveil : -1
      // Le réveil : tout flambe d'un coup, puis redescend.
      const flamme =
        r >= 0 ? Math.max(0, r < 0.25 ? r / 0.25 : 1 - (r - 0.25) / (REVEIL_S - 0.25)) : 0
      const pouls = 0.85 + 0.15 * Math.sin(temps * 5)
      const vie = presence * (0.25 + 0.75 * niveau) * pouls
      const { yeux, coeur, voyants, epaules } = ROBOT

      // Les yeux : une veilleuse qui grandit avec la charge ; au réveil, un trait de lumière.
      const oeil = Math.max(vie, flamme)
      lueur(
        x,
        yeux.x,
        yeux.y,
        3 + 7 * oeil,
        `rgba(170,245,255,${0.55 + 0.45 * oeil})`, // couleur-fixe: lueur peinte du décor de l'atelier
        'rgba(60,200,255,0)' // couleur-fixe: lueur peinte du décor de l'atelier
      ) // couleur-fixe: yeux du robot
      if (flamme > 0) {
        x.globalAlpha = flamme
        lueur(x, yeux.x, yeux.y, 26 * flamme, 'rgba(200,250,255,.7)', 'rgba(80,200,255,0)') // couleur-fixe: yeux qui flambent
        x.fillStyle = 'rgba(220,252,255,.9)' // couleur-fixe: trait de lumière des yeux
        x.fillRect(yeux.x - 40 * flamme, yeux.y - 0.6, 80 * flamme, 1.2)
        x.globalAlpha = 1
      }
      // Les voyants de poitrine : ils clignotent à chaque étincelle reçue.
      for (const [i, v] of voyants.entries()) {
        const k = Math.max(vie * 0.6, eclat * (i === 0 ? 1 : 0.7), flamme)
        lueur(x, v.x, v.y, 3 + 5 * k, `rgba(255,230,120,${0.3 + 0.6 * k})`, 'rgba(255,190,40,0)') // couleur-fixe: voyants de poitrine
      }
      // Le cœur : il rougeoie avec la charge, blanchit à chaque arrivée.
      const c = Math.max(vie, eclat, flamme)
      lueur(
        x,
        coeur.x,
        coeur.y,
        4 + 9 * c,
        `rgba(255,${(150 + 90 * eclat) | 0},${(90 + 140 * eclat) | 0},${0.4 + 0.6 * c})`, // couleur-fixe: lueur peinte du décor de l'atelier
        'rgba(255,60,20,0)' // couleur-fixe: lueur peinte du décor de l'atelier
      ) // couleur-fixe: cœur du robot
      if (eclat > 0.6) {
        x.strokeStyle = `rgba(255,240,200,${(eclat - 0.6) * 2})` // couleur-fixe: anneau d'une étincelle reçue
        x.lineWidth = 1
        x.beginPath()
        x.arc(coeur.x, coeur.y, 4 + (1 - eclat) * 30, 0, Math.PI * 2)
        x.stroke()
      }

      if (r >= 0) {
        // L'onde de choc, deux anneaux.
        for (const decal of [0, 0.18]) {
          const t = (r - decal) / 0.9
          if (t <= 0 || t >= 1) continue
          x.strokeStyle = `rgba(255,236,170,${(1 - t) * 0.9})` // couleur-fixe: onde de choc du réveil
          x.lineWidth = 3.2 * (1 - t) + 0.6
          x.beginPath()
          x.ellipse(coeur.x, coeur.y, 10 + 110 * t, 6 + 55 * t, 0, 0, Math.PI * 2)
          x.stroke()
        }
        // Les éclairs sur la carcasse, redessinés huit fois par seconde.
        if (r < 1.8) {
          const tirage = Math.floor(r * 12)
          x.strokeStyle = `rgba(190,245,255,${0.9 * (1 - r / 1.8)})` // couleur-fixe: éclairs du réveil
          x.lineWidth = 1.1
          x.lineJoin = 'round'
          for (let i = 0; i < 3; i++) {
            const pts = ROBOT.carcasse
            const a = pts[Math.floor(hasard(tirage * 13 + i) * pts.length)]
            const b = pts[Math.floor(hasard(tirage * 29 + i * 5) * pts.length)]
            if (a !== b) eclair(x, a, b, tirage * 101 + i * 17)
          }
        }
      }
      x.restore()

      // La vapeur des épaules, au réveil : des bouffées blanches qui montent et s'ouvrent.
      if (r >= 0.15 && r < REVEIL_S) {
        x.save()
        for (const [j, ep] of epaules.entries()) {
          for (let i = 0; i < 5; i++) {
            const t = (r - 0.15 - i * 0.12) / 1.6
            if (t <= 0 || t >= 1) continue
            const dx = (j === 0 ? -1 : 1) * (4 + 14 * t) + (hasard(i + j * 9) - 0.5) * 6
            x.globalAlpha = 0.55 * (1 - t)
            x.fillStyle = '#f4efe6' // couleur-fixe: vapeur du réveil
            x.beginPath()
            x.arc(ep.x + dx, ep.y - 6 - 34 * t, 2.5 + 8 * t, 0, Math.PI * 2)
            x.fill()
          }
        }
        x.restore()
      }
    }
  }
}
