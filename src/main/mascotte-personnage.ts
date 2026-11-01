/**
 * LE PERSONNAGE DE LA MASCOTTE — « Filament blanc · Le chiffre » (conv-1227, 2026-10-28).
 *
 * Choix de l'utilisateur sur maquettes (/draft, dix tours) : « comment personnifier notre
 * mascotte » -> une frimousse, de petits bras, un chapeau qui porte le chiffre -> un vrai chapeau de
 * magicien à pointe pliée -> des bras qui bougent et lancent des sorts -> « toutes ces animations en
 * même temps + il dessine un glyphe, et le chiffre doit briller, pas l'étoile » -> « implémente le 2 ».
 *
 * Ce qui a été retenu :
 * - la bille garde son anneau ; elle gagne un visage et un chapeau de magicien à pointe pliée, dont
 *   l'étoile n'est plus qu'un contour de verre ;
 * - le CHIFFRE est dans l'étoile, plus gros, cerné de nuit, et c'est LUI qui brille (filament blanc,
 *   halo bleu, petit grésillement d'ampoule) ;
 * - AU TRAVAIL, tout à la fois : la main gauche pétrit une boule d'énergie puis la lance en boule de
 *   feu ; la baguette de la main droite ÉCRIT LE CHIFFRE dans l'air (sa pointe suit le tracé, par
 *   cinématique inverse), le chiffre tracé s'envole dans le chapeau et le chiffre s'embrase ; trois
 *   feux follets tournent, notes et runes montent, trois pantins dansent dessous ;
 * - POUR TOI : bras levés, feux follets et comète filent dans le chiffre qui s'embrase, la boule
 *   éclate, pluie d'étoiles, sceau d'or au sol, les pantins sautent, le chiffre en or flotte à droite.
 *
 * Calme et problème n'ont pas été dessinés sur maquette : calme = yeux fermés, bras au repos (le
 * « z » existait déjà) ; problème = bras au repos, « ! » rouge dans l'étoile, halo rouge comme avant.
 * Depuis, le visage change d'expression dans chaque état (`visage`) et le halo est un grand glyphe
 * (`glypheDuHalo`). Puis (même jour) : un GRIMOIRE remplace les trois pantins (`grimoire`), la main
 * gauche INVOQUE au lieu de lancer une boule de feu (`invocation`, d'après une capture de
 * l'utilisateur), et au sommet du sort les yeux s'allument et l'énergie en jaillit.
 *
 * Une unité du dessin vaut 1 px : la bille occupe la boîte (0,0)-(52,52), celle de `.bw`. Tout le
 * dessin est FIXE dans la page (aucun script) : chaque état n'affiche que ses groupes
 * (`reglesDuPersonnage`). Les animations en boucle tournent dès le chargement, même dans un groupe
 * éteint (sondé le 2026-10-28) ; celles qui doivent partir au changement d'état sont posées par la
 * feuille de l'état (`Options.une`).
 */

type Pt = readonly [number, number]
/** Une image clé : [pourcentage, déclarations CSS]. */
type Image = readonly [number, string]

/** La fenêtre : le personnage déborde de la bille (chapeau, bras, sorts, pantins). */
export const LARGEUR_MASCOTTE = 128
export const HAUTEUR_MASCOTTE = 124
/** Le centre de la bille dans la fenêtre : plus de place au-dessus (le chapeau) qu'en dessous. */
export const CENTRE_BILLE = { x: 64, y: 70 } as const
/** Le coin haut-gauche de la boîte de la bille (52 px) dans la fenêtre. */
const ORIGINE = { x: CENTRE_BILLE.x - 26, y: CENTRE_BILLE.y - 26 }

/**
 * Ce que peut afficher l'étoile : le VRAI compte, de 1 à 99 (conv-1270, « affiche le vrai nombre sur
 * le chapeau jusqu'à 99 au lieu de 9+ »), et « ! » sur un échec. Un chiffre seul a ses propres
 * dessins (`SEULS`) ; un nombre à deux chiffres n'a pas 90 dessins : il allume une DIZAINE (1 à 9) et
 * une UNITÉ (0 à 9), chacune dessinée à sa place (`Place`). Toute la page reste fixe, sans script.
 */
const SEULS = ['1', '2', '3', '4', '5', '6', '7', '8', '9'] as const
const DIZAINES = SEULS
const UNITES = ['0', ...SEULS] as const
type Place = 'd' | 'u'
const CHIFFRES_DE: Record<Place, readonly string[]> = { d: DIZAINES, u: UNITES }
/** Les suffixes de tous les dessins de chiffres (`v…` affiché, `t…` écrit) : 9 + 9 + 10. */
const SUFFIXES = [...SEULS, ...DIZAINES.map((c) => `d${c}`), ...UNITES.map((c) => `u${c}`)]
/** Le compte lu chiffre par chiffre ; `null` = pas un compte de 1 à 99. */
function lireLeCompte(valeur: string | null): readonly [string] | readonly [string, string] | null {
  if (valeur === null || !/^[1-9][0-9]?$/u.test(valeur)) return null
  return valeur.length === 1 ? [valeur] : [valeur[0], valeur[1]]
}
/** Les classes à allumer pour cette valeur (`v` + suffixe) ou pour son tracé (`t` + suffixe). */
function classesDe(prefixe: 'v' | 't', valeur: string | null): string[] {
  const chiffres = lireLeCompte(valeur)
  if (!chiffres) return []
  return chiffres.length === 1
    ? [`${prefixe}${chiffres[0]}`]
    : [`${prefixe}d${chiffres[0]}`, `${prefixe}u${chiffres[1]}`]
}
/** Les classes du chiffre affiché ; vide = rien d'affichable (rien n'entre dans la page). */
export function classesDeLaValeur(valeur: string | null): string[] {
  return valeur === '!' ? ['vx'] : classesDe('v', valeur)
}
/** Les groupes « la baguette écrit ce compte » (bras droit, tracé, chiffre qui s'embrase). */
export function classesDuTrace(valeur: string | null): string[] {
  return classesDe('t', valeur)
}

const r1 = (v: number): number => Math.round(v * 10) / 10
const r2 = (v: number): number => Math.round(v * 100) / 100

// ---------------- Dégradés et motifs ----------------
const st = (o: number, c: string, a = 1): string =>
  `<stop offset="${o}" stop-color="${c}"${a < 1 ? ` stop-opacity="${a}"` : ''}/>`
const lin = (id: string, stops: string, x2 = 1, y2 = 1): string =>
  `<linearGradient id="${id}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops}</linearGradient>`
const rad = (id: string, stops: string, cx = 0.5, cy = 0.5, r = 0.5): string =>
  `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${stops}</radialGradient>`
const orbe = (id: string, c: string): string => rad(id, st(0, '#fff') + st(0.35, c) + st(1, c, 0))
const lueur = (id: string, c: string): string =>
  rad(id, st(0, c, 0.95) + st(0.4, c, 0.5) + st(1, c, 0))

const OR = '#ffd65c'
/** Les couleurs de l'invocation (la capture de l'utilisateur, conv-1227) : cyan, rose, et l'or. */
const CYAN = '#8ff0ff'
const ROSE = '#ff8fd8'
const PLIEE =
  'M7 8C11-4 16-16 21-25Q24-31 30-31Q37-31 41-23Q36-27 32-24Q30-19 33-10C36-2 41 4 45 8Z'
function etoile(cx: number, cy: number, r: number): string {
  const p: string[] = []
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2
    const rr = i % 2 ? r * 0.48 : r
    p.push(`${r2(cx + rr * Math.cos(a))} ${r2(cy + rr * Math.sin(a))}`)
  }
  return `M${p.join('L')}Z`
}
const eclat = (x: number, y: number, r: number): string =>
  `M${r2(x)} ${r2(y - r)}q${r2(r / 4)} ${r2(r * 0.75)} ${r2(r)} ${r2(r)}q${r2(-r * 0.75)} ${r2(r / 4)}${r2(-r)} ${r2(r)}q${r2(-r / 4)}${r2(-r * 0.75)}${r2(-r)}${r2(-r)}q${r2(r * 0.75)}${r2(-r / 4)} ${r2(r)}${r2(-r)}Z`

/**
 * Les décors répétés sont des MOTIFS peints sur un `<rect>` : définis une fois, ils tournent et
 * grandissent autour du centre de leur rectangle (`transform-box: fill-box`).
 */
const BOITES = new Map<string, readonly [number, number, number, number]>()
function motif(
  id: string,
  boite: readonly [number, number, number, number],
  contenu: string
): string {
  BOITES.set(id, boite)
  return `<pattern id="${id}" width="1" height="1" viewBox="${boite.join(' ')}">${contenu}</pattern>`
}
function peint(id: string, k = 1): string {
  const [x, y, w, h] = BOITES.get(id) ?? [0, 0, 0, 0]
  return `<rect x="${r2(x * k)}" y="${r2(y * k)}" width="${r2(w * k)}" height="${r2(h * k)}" fill="url(#${id})"/>`
}
/** Pose un contenu en (x, y), animé par `classe` ; un motif seul est décalé sans groupe d'enrobage. */
function placer(x: number, y: number, contenu: string, classe = ''): string {
  const seul =
    /^<rect x="([-\d.]+)" y="([-\d.]+)" (width="[^"]+" height="[^"]+" fill="[^"]+")\/>$/u.exec(
      contenu
    )
  if (seul)
    return `<rect${classe ? ` class="${classe}"` : ''} x="${r2(x + Number(seul[1]))}" y="${r2(y + Number(seul[2]))}" ${seul[3]}/>`
  return `<g transform="translate(${r2(x)} ${r2(y)})"><g${classe ? ` class="${classe}"` : ''}>${contenu}</g></g>`
}

const FOLLET = `<circle r="8" fill="url(#gGt)"/><path d="M0-6.5C2.6-3 4-.8 4 1.4a4 4 0 0 1-8 0C-4-.8-2.6-3 0-6.5Z" fill="url(#oT)"/><circle cx="-1.3" cy="1" r=".7" fill="#0e3b33"/><circle cx="1.3" cy="1" r=".7" fill="#0e3b33"/>`
const note = (c: string): string =>
  `<ellipse rx="1.9" ry="1.35" transform="rotate(-20)" fill="${c}"/><path d="M1.6-.3V-6.5q2.2 1 2.6 3.2" stroke="${c}" stroke-width=".8" fill="none"/>`
const boule = (c: string, o: string): string =>
  `<ellipse cy="7" rx="3.4" ry="9" fill="url(#${c})"/><circle r="8.5" fill="url(#${c})"/><circle r="4.4" fill="url(#${o})"/>`
const SCEAU =
  `<circle r="10" stroke="${OR}" stroke-width="1.3" stroke-dasharray="2.6 1.8" fill="none"/><circle r="6.6" stroke="#fff3c4" stroke-width=".9" fill="none"/>` +
  [0, 60, 120, 180, 240, 300]
    .map(
      (a) =>
        `<path d="M0-7.6v-1.6M-1 -8.4h2" stroke="#fff3c4" stroke-width=".9" transform="rotate(${a})"/>`
    )
    .join('')

function defs(): string {
  return (
    '<defs>' +
    rad('gSh', st(0, '#000', 0.45) + st(1, '#000', 0)) +
    lin('gH', st(0, '#a99cff') + st(0.4, '#6556e8') + st(1, '#2c2190'), 1, 0.6) +
    rad('gB', st(0, '#8a7ef5') + st(1, '#251c78'), 0.45, 0.3, 0.7) +
    lueur('gGo', '#ffc93d') +
    lueur('gGb', '#6fb6ff') +
    lueur('gGt', '#3ff0c8') +
    lueur('gGf', '#ff7a2a') +
    orbe('oB', '#bfe6ff') +
    orbe('oA', '#ffe9a0') +
    // Les mains noires : une boule d'encre, un reflet en haut à gauche, sans lueur.
    rad('mNr', st(0, '#4a4563') + st(0.45, '#15121f') + st(1, '#07060c'), 0.35, 0.3, 0.75) +
    orbe('oT', '#a6ffe9') +
    orbe('oF', '#ffc08a') +
    // L'invocation de la main gauche : sphère violette, éclair blanc.
    rad('oS', st(0, '#ffffff') + st(0.3, '#efe8ff') + st(0.72, '#a77bff') + st(1, '#6b3cff', 0)) +
    lueur('gSv', '#b48cff') +
    lueur('gFl', '#ffffff') +
    // Le grimoire : pages crème, couverture violette.
    lin('gPg', st(0, '#fffaf0') + st(1, '#e6d2a2'), 0, 1) +
    lin('gCv', st(0, '#7a52d6') + st(1, '#2a1766'), 0, 1) +
    motif('mFo', [-8, -8, 16, 16], FOLLET) +
    motif('mNo', [-2.4, -7.2, 7.2, 9], note(OR)) +
    motif('mEc', [-1, -1, 2, 2], `<path d="${eclat(0, 0, 1)}" fill="${OR}"/>`) +
    motif('mFg', [-9, -9, 18, 25], boule('gGo', 'oA')) +
    motif('mSc', [-11, -11, 22, 22], SCEAU) +
    motif(
      'mGe',
      [-7, -9, 14, 18],
      `<path d="${(
        [
          [0, -6, 2.4],
          [-5, 2, 1.8],
          [5, 3, 1.6],
          [0, 6, 1.4]
        ] as const
      )
        .map(([x, y, r]) => eclat(x, y, r))
        .join('')}" fill="${OR}"/>`
    ) +
    '</defs>'
  )
}

// ---------------- Les animations : une classe par (images clés, durée, retard, courbe) ----------------
/**
 * `delai` : avance dans le cycle (retard négatif) ; `une` : jouée UNE fois, au moment où l'état la
 * DÉCLENCHE, puis figée sur sa dernière image (l'ouverture du grimoire, conv-1227).
 *
 * Pourquoi la déclencher par l'état : dans ce dessin SVG, une animation tourne dès le chargement de
 * la page, même dans un groupe éteint (`display:none`) — sondé le 2026-10-28 avec
 * `document.getAnimations()` : 561 ms écoulés 30 ms après le passage au travail. Une animation
 * jouée une fois serait donc finie avant qu'on la voie. Sa règle n'est pas dans la page : elle est
 * rendue dans `declenchees`, et la feuille de l'état la pose (`reglesDuPersonnage`). L'animation part
 * quand la règle arrive, et ne repart pas tant que la même règle reste posée (changement de compte).
 */
type Options = { delai?: number; courbe?: string; une?: boolean }
/**
 * `portee` : le dessin que la feuille anime (`.p` le personnage, `.y` le visage, deux SVG
 * distincts) ; `prefixe` : celui de ses classes, pour que les deux feuilles ne se croisent pas.
 */
function creerFeuille(
  portee = '.p',
  prefixe = 'a'
): {
  anim: (images: readonly Image[], duree: number, o?: Options) => string
  regles: string[]
  declenchees: Array<[string, string]>
} {
  const regles: string[] = []
  const declenchees: Array<[string, string]> = []
  const corps = new Map<string, string>()
  const classes = new Map<string, string>()
  let n = 0
  const anim = (
    images: readonly Image[],
    duree: number,
    { delai = 0, courbe = 'ease-in-out', une = false }: Options = {}
  ): string => {
    const texte = images.map(([p, d]) => `${r2(p)}%{${d}}`).join('')
    const cle = `${texte}|${duree}|${delai}|${courbe}|${une}`
    const deja = classes.get(cle)
    if (deja) return deja
    const nom = `${prefixe}${(n++).toString(36)}`
    let kf = corps.get(texte)
    if (!kf) {
      kf = nom
      corps.set(texte, kf)
      regles.push(`@keyframes ${kf}{${texte}}`)
    }
    const animation = `${kf} ${duree}s ${courbe}${delai ? ` ${r2(-delai)}s` : ''}`
    if (une) declenchees.push([`.${nom}`, `animation:${animation} 1 both`])
    else regles.push(`${portee} .${nom}{animation:${animation} infinite}`)
    classes.set(cle, nom)
    return nom
  }
  return { anim, regles, declenchees }
}

// ---------------- Les bras : cinématique inverse ----------------
// Chaque bras = épaule S, vecteur bras U, vecteur avant-bras F (au repos, mains devant la bille).
// On donne une trajectoire à la main (ou à la pointe de la baguette) ; on en déduit l'angle de
// l'épaule et du coude à chaque image clé.
const S_L: Pt = [3, 32]
const S_R: Pt = [49, 32]
const U_L: Pt = [-1, 11]
const F_L: Pt = [12, 5]
const U_R: Pt = [1, 11]
const F_R: Pt = [-12, 5]
/** La baguette prolonge l'avant-bras droit : sa pointe est à F × BAG. */
const BAG = 1.42
const F_BAG: Pt = [F_R[0] * BAG, F_R[1] * BAG]
const preferD = (ex: number, ey: number): number => ey + 0.3 * ex // coude droit : en bas, dehors
const preferG = (ex: number, ey: number): number => -ex + 0.3 * ey // coude gauche : dehors

type Pose = { a1: number; a2: number; ex: number; ey: number }
function ik(S: Pt, U: Pt, F: Pt, T: Pt, sg: 1 | -1): Pose {
  const L1 = Math.hypot(U[0], U[1])
  const L2 = Math.hypot(F[0], F[1])
  const dx = T[0] - S[0]
  const dy = T[1] - S[1]
  const d = Math.min(Math.max(Math.hypot(dx, dy), Math.abs(L1 - L2) + 0.05), L1 + L2 - 0.05)
  const c = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2)
  const phi = sg * Math.acos(Math.max(-1, Math.min(1, c)))
  const th1 = Math.atan2(dy, dx) - Math.atan2(L2 * Math.sin(phi), L1 + L2 * Math.cos(phi))
  const a1 = th1 - Math.atan2(U[1], U[0])
  const a2 = th1 + phi - Math.atan2(F[1], F[0]) - a1
  return {
    a1: (a1 * 180) / Math.PI,
    a2: (a2 * 180) / Math.PI,
    ex: S[0] + L1 * Math.cos(th1),
    ey: S[1] + L1 * Math.sin(th1)
  }
}
function tourner([x, y]: Pt, deg: number): Pt {
  const a = (deg * Math.PI) / 180
  return [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]
}
/** Où est la main (ou la pointe) pour ces deux angles. */
function main(S: Pt, U: Pt, F: Pt, a1: number, a2: number): Pt {
  const f = tourner(F, a2)
  const v = tourner([U[0] + f[0], U[1] + f[1]], a1)
  return [S[0] + v[0], S[1] + v[1]]
}
/** Douglas-Peucker sur une courbe (t, angle) : ne garde que les images clés utiles. */
function simplifier(
  pts: ReadonlyArray<readonly [number, number]>,
  tol: number
): Array<readonly [number, number]> {
  if (pts.length < 3) return [...pts]
  const a = pts[0]
  const b = pts[pts.length - 1]
  let iMax = 0
  let dMax = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const v = a[1] + ((b[1] - a[1]) * (pts[i][0] - a[0])) / (b[0] - a[0] || 1)
    const d = Math.abs(pts[i][1] - v)
    if (d > dMax) {
      dMax = d
      iMax = i
    }
  }
  if (dMax <= tol) return [a, b]
  return [
    ...simplifier(pts.slice(0, iMax + 1), tol).slice(0, -1),
    ...simplifier(pts.slice(iMax), tol)
  ]
}

type Feuille = ReturnType<typeof creerFeuille>
/**
 * Les deux articulations qui mènent la main par `cibles` ([%, point]). Rend leurs classes
 * d'animation, et l'ÉCART : la plus grande distance entre la main et sa cible, une fois les images
 * clés simplifiées et arrondies au degré (ce que la page joue vraiment).
 */
function resoudre(
  f: Feuille,
  S: Pt,
  U: Pt,
  F: Pt,
  cibles: ReadonlyArray<readonly [number, Pt]>,
  prefere: (ex: number, ey: number) => number,
  duree: number,
  opts: Options = {}
): {
  joints: readonly [string, string]
  ecart: number
  droit: () => string
  angles: (t: number) => readonly [number, number]
} {
  const sols = ([1, -1] as const).map((sg) => cibles.map(([, T]) => ik(S, U, F, T, sg)))
  const note = (sol: Pose[]): number => sol.reduce((a, s) => a + prefere(s.ex, s.ey), 0)
  const sol = note(sols[0]) >= note(sols[1]) ? sols[0] : sols[1]
  // Angles déroulés : jamais un saut de 360° entre deux images (le bras ferait un tour entier).
  const A1: number[] = []
  const A2: number[] = []
  sol.forEach((s, i) => {
    let x = s.a1
    let y = s.a2
    if (i) {
      while (x - A1[i - 1] > 180) x -= 360
      while (x - A1[i - 1] < -180) x += 360
      while (y - A2[i - 1] > 180) y -= 360
      while (y - A2[i - 1] < -180) y += 360
    }
    A1.push(x)
    A2.push(y)
  })
  const images = (A: number[]): Array<readonly [number, number]> =>
    simplifier(
      cibles.map(([t], i) => [r1(t), A[i]] as const),
      1.4
    ).map(([t, a]) => [t, Math.round(a)] as const)
  const I1 = images(A1)
  const I2 = images(A2)
  const valeur = (I: ReadonlyArray<readonly [number, number]>, t: number): number => {
    const j = I.findIndex(([tt]) => tt >= t)
    if (j <= 0) return I[Math.max(j, 0)][1]
    const [a, b] = [I[j - 1], I[j]]
    return a[1] + ((b[1] - a[1]) * (t - a[0])) / (b[0] - a[0] || 1)
  }
  let ecart = 0
  for (const [t, T] of cibles) {
    const m = main(S, U, F, valeur(I1, r1(t)), valeur(I2, r1(t)))
    ecart = Math.max(ecart, Math.hypot(m[0] - T[0], m[1] - T[1]))
  }
  const rot = (I: ReadonlyArray<readonly [number, number]>): string =>
    f.anim(
      I.map(([t, a]) => [t, `rotate:${a}deg`] as const),
      duree,
      { courbe: 'linear', ...opts }
    )
  // Ce que tient la main, gardé DROIT malgré l'épaule et le coude (la main ouverte de l'invocation) :
  // l'inverse de la somme des deux rotations, aux instants de l'une ou de l'autre. Entre deux
  // instants, les deux varient linéairement : leur somme aussi, la compensation est exacte.
  // Créée à la demande, pour ne pas ajouter une animation à chaque bras.
  const droit = (): string => {
    const instants = [...new Set([...I1, ...I2].map(([t]) => t))].sort((a, b) => a - b)
    return f.anim(
      instants.map((t) => [t, `rotate:${r1(-(valeur(I1, t) + valeur(I2, t)))}deg`] as const),
      duree,
      { courbe: 'linear', ...opts }
    )
  }
  // Les deux angles que la page joue à l'instant `t` (le relais des bras d'un nombre à deux chiffres).
  const angles = (t: number): readonly [number, number] => [valeur(I1, t), valeur(I2, t)]
  return { joints: [rot(I1), rot(I2)], ecart, droit, angles }
}

/**
 * L'ENCRE DU TRACÉ, AUX COULEURS DES YEUX (conv-1247, 2026-10-28, « le numéro que la mascotte
 * dessine doit être de la couleur dont les yeux vont s'allumer et changer la couleur de l'étoile du
 * chapeau », puis « au moment où un chiffre rouge atteint l'étoile, ça met l'étoile rouge »). Elle
 * était rouge à chaque sort (conv-1227, « le chiffre qu'il est en train de dessiner doit être rouge et
 * plus gros »). Un sort par couleur, dans l'ordre des yeux (`COULEURS_DES_YEUX` de `visage`) : cyan,
 * rouge, jaune, vert. `coeur` : le trait écrit ; `vif` : l'iris des yeux de lumière, le halo du trait
 * et l'étoile du chapeau ; `bord` : le contour de l'étoile.
 */
const COULEURS_DU_SORT = [
  { coeur: '#9fe2ff', vif: '#58c8ff', bord: '#d2f8ff' },
  { coeur: '#ff8a7e', vif: '#ff3b2f', bord: '#ffd6cf' },
  { coeur: '#ffe680', vif: '#ffd21f', bord: '#fff6c2' },
  { coeur: '#8ff09f', vif: '#3ee05a', bord: '#d6ffd2' }
] as const
type Encre = (typeof COULEURS_DU_SORT)[number]
const lueurDe = (c: string): string => `gl${c.slice(1)}`
// Plus de lueur cyan ni rose : seuls les trois cercles magiques s'en servaient (retirés, conv-1258).
const LUEURS = [...COULEURS_DU_SORT.map((c) => c.vif), OR]

function seg(dx: number, dy: number, b: number): string {
  const l = Math.hypot(dx, dy) || 1
  return `M0 0q${r2(dx / 2 + (-dy / l) * b)} ${r2(dy / 2 + (dx / l) * b)} ${r2(dx)} ${r2(dy)}`
}
/**
 * BRAS NOIRS (conv-1227, 2026-10-28, « ses bras doivent être noirs, pas lumineux ») : ils étaient
 * des filaments de lumière (bleus au travail, dorés pour toi). Ils sont maintenant d'encre mate, sans
 * aucune lueur, avec un reflet discret pour garder le volume. Seule la pointe de la baguette brille.
 */
const ENCRE_NOIRE = '#0c0a16'
const REFLET_NOIR = '#57516f'
const trait = (d: string): string =>
  `<path d="${d}" stroke="${ENCRE_NOIRE}" stroke-width="2.6" fill="none"/>` +
  `<path d="${d}" stroke="${REFLET_NOIR}" stroke-opacity=".6" stroke-width=".6" fill="none"/>`
function bras(
  S: Pt,
  U: Pt,
  F: Pt,
  [a1, a2]: readonly [string, string],
  tenu = '',
  rayonMain = 4.4
): string {
  const s = S === S_L ? 1 : -1
  return (
    `<g transform="translate(${S[0]} ${S[1]})"><g class="jt ${a1}">${trait(seg(U[0], U[1], 1.2 * s))}` +
    `<g transform="translate(${U[0]} ${U[1]})"><g class="jt ${a2}">${trait(seg(F[0], F[1], -s))}` +
    `${tenu}<circle cx="${F[0]}" cy="${F[1]}" r="${rayonMain}" fill="url(#mNr)"/></g></g></g></g>`
  )
}
const REPOS = ['', ''] as const
/** La baguette, du poing à la pointe, qui brille. */
function baguette(pointe: string): string {
  const [x, y] = F_R
  return `<path d="M${x} ${y}L${r2(F_BAG[0])} ${r2(F_BAG[1])}" stroke="#d9a868" stroke-width="1.5"/><circle cx="${r2(F_BAG[0])}" cy="${r2(F_BAG[1])}" r="2.6" fill="url(#${pointe})"/>`
}
/**
 * La main OUVERTE, paume vers le haut, comme sur la capture de l'utilisateur : dessinée droite, le
 * poignet en (0, 0), les doigts écartés vers l'extérieur (à gauche). Le bras la tient par
 * `resoudre(...).droit` : elle reste paume en l'air quoi que fassent l'épaule et le coude.
 */
const DOIGTS =
  'M-1.2-.9Q.6-3.2 1.3-5.4M-2.9-1.6Q-2.6-5-2.2-7.6M-4.4-1.8Q-4.6-5.6-4.9-8.3M-5.8-1.6Q-6.7-5-7.4-7.3M-7-1Q-8.6-3.2-9.6-5'
const MAIN_OUVERTE =
  `<path d="M.6 .4Q-3.4 2.8-7.6-.4Q-4.2-2.4-.8-1.2Z" fill="${ENCRE_NOIRE}"/>` +
  `<path d="M.6 .4Q-3.4 2.8-7.6-.4${DOIGTS}" stroke="${ENCRE_NOIRE}" stroke-width="1.5" fill="none"/>` +
  `<path d="${DOIGTS}" stroke="${REFLET_NOIR}" stroke-opacity=".6" stroke-width=".4" fill="none"/>`

// ---------------- Les glyphes : chaque chiffre, tel que la baguette l'écrit ----------------
const longueur = (pts: readonly Pt[]): number =>
  pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0)
function densifier(pts: readonly Pt[], pas: number): Pt[] {
  const out: Pt[] = [pts[0]]
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]]
    const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / pas))
    for (let k = 1; k <= n; k++)
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n])
  }
  return out
}
const arc = (cx: number, cy: number, r: number, d0: number, d1: number, n: number): Pt[] =>
  ovale(r, r, d0, d1, n).map(([x, y]) => [cx + x, cy + y] as const)
function ovale(rx: number, ry: number, d0: number, d1: number, n: number): Pt[] {
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = ((d0 + ((d1 - d0) * i) / n) * Math.PI) / 180
    return [rx * Math.cos(a), ry * Math.sin(a)] as const
  })
}
/**
 * Centre du glyphe, à droite du personnage : assez loin de l'épaule droite pour que la baguette
 * l'atteigne (avant-bras + baguette plus longs que le bras : rien n'est atteignable à moins de 7,4
 * de l'épaule), et assez près pour ne jamais tendre le bras à fond.
 */
const G: Pt = [65, 26]
/** Les traits de chaque signe, dans une boîte d'environ 9 × 17 centrée sur 0 (y vers le bas). */
const SIGNES: Record<string, Pt[][]> = {
  '1': [
    [
      [-3, -4.5],
      [1, -8],
      [1, 8]
    ]
  ],
  '2': [[...arc(0, -3.6, 4.2, -160, 20, 14), [-4.4, 8], [4.6, 8]]],
  '3': [[...arc(0, -3.9, 4, -150, 90, 12), ...arc(0, 4.5, 4.4, -90, 150, 13).slice(1)]],
  '4': [
    [
      [2.5, 8],
      [2.5, -8],
      [-5, 3.5],
      [5.2, 3.5]
    ]
  ],
  '5': [[[4.2, -8], [-3.2, -8], [-3.8, -1.2], ...arc(0, 3.4, 4.6, -130, 150, 16)]],
  '6': [[[3.4, -8], [0.6, -6.6], [-2.4, -3.8], [-4, -0.2], ...arc(0, 3.6, 4.2, 180, 540, 24)]],
  '7': [
    [
      [-4.5, -8],
      [4.5, -8],
      [-1, 8]
    ]
  ],
  '8': [[...arc(0, -4.3, 3.8, 90, 450, 20), ...arc(0, 4.2, 4.4, -90, -450, 22).slice(1)]],
  '9': [[...arc(0, -3.6, 4.2, 0, -360, 22), [4.2, 1], [3.2, 5], [0.5, 7.8], [-2.8, 8.2]]],
  // Le 0 n'existe qu'en unité (10, 20…, conv-1270) : un ovale tracé d'un trait, depuis le haut, vers
  // la gauche, comme à la main. (Le « + » de « 9+ » est parti avec lui.)
  '0': [ovale(4.2, 8, -100, -460, 30)]
}
/**
 * Le chiffre écrit est 1,35 fois plus grand que la boîte des signes (conv-1227, « plus gros ») :
 * environ 12 × 23 px. Son coin le plus lointain reste à portée de la baguette (28,8 px de l'épaule
 * pour 29,5 au plus), ce que vérifie l'écart mesuré par le test.
 */
const ECHELLE_TRACE = 1.35
const poser = (traits: Pt[][], k: number, dx: number, centre: Pt = G): Pt[][] =>
  traits.map((t) =>
    t.map(
      ([x, y]) =>
        [centre[0] + (dx + x * k) * ECHELLE_TRACE, centre[1] + y * k * ECHELLE_TRACE] as const
    )
  )
/** Les traits d'un chiffre seul, à sa place. */
const traitsDuChiffre = (valeur: string): Pt[][] => poser(SIGNES[valeur] ?? [], 1, 0)
/**
 * DEUX CHIFFRES CÔTE À CÔTE (conv-1270) : la baguette n'atteint que l'anneau compris entre 7,4 et
 * 29,5 px de l'épaule droite, trop étroit pour deux chiffres de la taille d'un chiffre seul. Chacun
 * est donc réduit à 0,7 (environ 8,5 × 15 px, la taille du 9 de l'ancien « 9+ »), leurs centres à
 * 10,8 px l'un de l'autre, et la paire descend un peu (centre `G2`) : c'est la place qui garde le
 * plus de marge (plus de 0,8 px) sur les deux bords de l'anneau, pour les 19 chiffres possibles —
 * cherchée par calcul le 2026-10-29, ce que vérifie l'écart mesuré par le test.
 */
const K_DEUX = 0.7
const ECART_DEUX = 4
const G2: Pt = [66.75, 32]
const traitsALaPlace = (chiffre: string, place: Place): Pt[][] =>
  poser(SIGNES[chiffre] ?? [], K_DEUX, place === 'd' ? -ECART_DEUX : ECART_DEUX, G2)
const dChemin = (pts: readonly Pt[]): string =>
  'M' + pts.map(([x, y]) => `${r1(x)} ${r1(y)}`).join('L')

/**
 * Le chiffre, tel qu'il s'affiche dans l'étoile (`classe` : son allure). Toujours blanc, et plus gros
 * depuis conv-1227 (« celui du chapeau toujours blanc mais plus gros aussi », puis « le chiffre peut
 * dépasser de l'étoile, c'est pas grave ») : 26 px au lieu de 16. Il déborde de l'étoile (21 px de
 * large) ; sa ligne de base est abaissée pour que son centre reste sur celui de l'étoile (y = -3).
 */
function texteChiffre(valeur: string, classe: string, remplissage: string): string {
  return `<text class="${classe}" x="25" y="6" text-anchor="middle" font-family="Segoe UI,Arial,sans-serif" font-weight="800" font-size="26" fill="${remplissage}">${valeur}</text>`
}
/**
 * Un chiffre d'un nombre à deux chiffres, à sa place (conv-1270) : 20 px, comme l'ancien « 9+ ». La
 * dizaine finit en x = 25 (`end`), l'unité y commence (`start`) : les deux se touchent comme dans
 * un seul mot, et la paire reste centrée sur l'étoile quels que soient ses chiffres.
 */
function texteALaPlace(chiffre: string, place: Place, classe: string, remplissage: string): string {
  return `<text class="${classe}" x="25" y="4" text-anchor="${place === 'd' ? 'end' : 'start'}" font-family="Segoe UI,Arial,sans-serif" font-weight="800" font-size="20" fill="${remplissage}">${chiffre}</text>`
}
/**
 * Tous les chiffres que l'étoile peut montrer, dans une même allure : les seuls (suffixe `1`…), puis
 * les dizaines (`d1`…) et les unités (`u0`…) ; `classe(suffixe)` donne les classes de chacun.
 */
function textesDuCompte(classe: (suffixe: string) => string, remplissage: string): string {
  return (
    SEULS.map((v) => texteChiffre(v, classe(v), remplissage)).join('') +
    textesALaPlace(classe, remplissage)
  )
}
/** Les seuls chiffres à leur place (dizaines `d1`…, unités `u0`…). */
function textesALaPlace(classe: (suffixe: string) => string, remplissage: string): string {
  return (['d', 'u'] as const)
    .map((place) =>
      CHIFFRES_DE[place]
        .map((c) => texteALaPlace(c, place, classe(`${place}${c}`), remplissage))
        .join('')
    )
    .join('')
}

// ---------------- Le tracé : la pointe de la baguette écrit le compte ----------------
const T_FIN = 62
const T_TENUE = 80
/** Le chiffre écrit se pose sur l'étoile du chapeau (fin de son vol, juste avant qu'il s'efface). */
const T_ARRIVEE = T_TENUE - 2
const D_TRACE = 3.2

/**
 * Les couleurs se relaient d'un sort à l'autre : un cycle de `n` sorts, la couleur `k` allumée
 * (opacité 1) pendant le sort `k` seul. Les yeux (`visage`) et l'encre du tracé (`tracer`) jouent
 * ces MÊMES images clés sur la même durée (conv-1247) : le chiffre écrit a toujours la couleur dont
 * les yeux vont s'allumer. La bascule tombe entre deux sorts, quand les yeux sont éteints (`allume`
 * vaut 0 de 87 à 61 %) et l'encre effacée (de 88 % au premier trait) : on ne la voit jamais.
 */
function teinte(f: Feuille, k: number, n: number): string {
  const debut = (100 * k) / n
  const fin = (100 * (k + 1)) / n
  const images: Image[] =
    k === 0
      ? [
          [0, 'opacity:1'],
          [fin - 0.1, 'opacity:1'],
          [fin, 'opacity:0'],
          [99.9, 'opacity:0'],
          [100, 'opacity:1']
        ]
      : [
          [0, 'opacity:0'],
          [debut - 0.1, 'opacity:0'],
          [debut, 'opacity:1'],
          [fin - 0.1, 'opacity:1'],
          ...(fin < 100 ? ([[fin, 'opacity:0']] as const) : []),
          [100, 'opacity:0']
        ]
  return f.anim(images, n * D_TRACE, { courbe: 'linear' })
}
/**
 * Allumé (opacité 1) de `debut` à `fin`, en % du cycle, strictement entre 0 et 100 ; la plage fait le
 * tour du cycle quand `fin` < `debut`.
 */
function allumeDe(f: Feuille, debut: number, fin: number, duree: number): string {
  const on = (p: number): Image => [p, 'opacity:1']
  const off = (p: number): Image => [p, 'opacity:0']
  const images =
    debut < fin
      ? [off(0), off(debut - 0.1), on(debut), on(fin - 0.1), off(fin), off(100)]
      : [on(0), on(fin - 0.1), off(fin), off(debut - 0.1), on(debut), on(100)]
  return f.anim(images, duree, { courbe: 'linear' })
}

type Trace = { L: number; images: Array<readonly [number, number]> }
type Cible = readonly [number, Pt]
/**
 * Le chemin de la pointe sur les `traits`, de `t0` à `t1` (en % du cycle) : chaque trait à la vitesse
 * de l'écriture, les levés de plume plus vite — d'un trait au suivant, et, s'ils sont donnés, depuis
 * `depuis` jusqu'au premier trait et du dernier jusqu'à `vers`. Rend les cibles de la pointe, quand
 * chaque trait s'écrit, et le bout du dernier trait (`fin`).
 */
function planifier(
  traits: Pt[][],
  t0: number,
  t1: number,
  depuis?: Pt,
  vers?: Pt
): { cibles: Cible[]; traces: Trace[]; fin: Pt } {
  const denses = traits.map((t) => densifier(t, 1.2))
  const morceaux: Array<{ pts: Pt[]; plume: number }> = []
  const lever = (a: Pt, b: Pt): void => {
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) > 0.01)
      morceaux.push({ pts: densifier([a, b], 3), plume: -1 })
  }
  if (depuis) lever(depuis, denses[0][0])
  denses.forEach((tr, k) => {
    // Un trait levé : la pointe va d'un trait au suivant, plus vite.
    if (k) lever(denses[k - 1][denses[k - 1].length - 1], tr[0])
    morceaux.push({ pts: tr, plume: k })
  })
  const dernier = denses[denses.length - 1]
  const fin = dernier[dernier.length - 1]
  if (vers) lever(fin, vers)
  const poids = (m: { pts: Pt[]; plume: number }): number =>
    longueur(m.pts) * (m.plume < 0 ? 0.45 : 1)
  const total = morceaux.reduce((a, m) => a + poids(m), 0)
  const cibles: Cible[] = [[t0, morceaux[0].pts[0]]]
  const traces: Trace[] = denses.map((tr) => ({ L: longueur(tr), images: [] }))
  let t = t0
  for (const m of morceaux) {
    const L = longueur(m.pts)
    const duree = ((t1 - t0) * poids(m)) / total
    if (m.plume >= 0) traces[m.plume].images.push([t, 0], [t + duree, L])
    let s = 0
    for (let i = 1; i < m.pts.length; i++) {
      s += Math.hypot(m.pts[i][0] - m.pts[i - 1][0], m.pts[i][1] - m.pts[i - 1][1])
      cibles.push([r2(t + (duree * s) / L), m.pts[i]])
    }
    t += duree
  }
  return { cibles, traces, fin }
}
/** Le chiffre écrit, la pointe s'attarde jusqu'à `T_TENUE`, puis revient de `de` à `a` pour le suivant. */
function revenir(de: Pt, a: Pt): Cible[] {
  const retour = densifier([de, a], 3)
  return [
    [T_TENUE, de],
    ...retour
      .slice(1)
      .map((p, i): Cible => [r2(T_TENUE + ((100 - T_TENUE) * (i + 1)) / (retour.length - 1)), p])
  ]
}

/**
 * Les traits à l'encre du sort : chaque trait se dévoile derrière la pointe (pointillé dont le
 * décalage diminue), tient, puis s'efface ; le dernier posé, le glyphe s'allume.
 */
function encrer(f: Feuille, traits: Pt[][], traces: readonly Trace[]): string {
  const chemins = traces.map((tr, k) => {
    const cache = r1(tr.L + 2)
    const images: Image[] = [
      [0, `stroke-dashoffset:${cache};opacity:1`],
      [Math.max(0, r1(tr.images[0][0] - 0.1)), `stroke-dashoffset:${cache}`],
      ...tr.images.map(([tt, s]) => [r1(tt), `stroke-dashoffset:${r1(tr.L - s)}`] as const),
      [T_TENUE, 'stroke-dashoffset:0;opacity:1'],
      [T_TENUE + 8, 'stroke-dashoffset:0;opacity:0'],
      [T_TENUE + 9, `stroke-dashoffset:${cache};opacity:0`],
      [100, `stroke-dashoffset:${cache};opacity:0`]
    ]
    const classe = f.anim(images, D_TRACE, { courbe: 'linear' })
    return ({ coeur, vif }: Encre): string =>
      `<path class="${classe} ${lueurDe(vif)}" d="${dChemin(traits[k])}" stroke="${coeur}" stroke-width="2.1" stroke-dasharray="${r1(tr.L)} ${r1(tr.L + 4)}" fill="none"/>`
  })
  const eteint = 'filter:drop-shadow(0 0 0 transparent)'
  const allume = (vif: string): string =>
    f.anim(
      [
        [0, eteint],
        [T_FIN, eteint],
        [T_FIN + 3, `filter:drop-shadow(0 0 1.8px ${vif}) drop-shadow(0 0 4px ${vif})`],
        [T_TENUE + 4, `filter:drop-shadow(0 0 1.8px ${vif}) drop-shadow(0 0 4px ${vif})`],
        [T_TENUE + 8, eteint],
        [100, eteint]
      ],
      D_TRACE,
      { courbe: 'linear' }
    )
  // Le chiffre écrit dans chaque encre ; seule celle du sort en cours est allumée (`teinte`).
  const n = COULEURS_DU_SORT.length
  return COULEURS_DU_SORT.map(
    (c, k) =>
      `<g class="${teinte(f, k, n)}"><g class="${allume(c.vif)}">${chemins.map((ch) => ch(c)).join('')}</g></g>`
  ).join('')
}
/** Le glyphe écrit autour de `centre` s'envole se fondre dans le chiffre du chapeau. */
function volVersLeChapeau(f: Feuille, centre: Pt): string {
  const versLeChapeau = `translate:${r2(25 - centre[0])}px ${r2(-3 - centre[1])}px`
  return f.anim(
    [
      [0, 'translate:0 0;scale:1;opacity:1'],
      [T_FIN + 2, 'translate:0 0;scale:1;opacity:1'],
      [T_ARRIVEE, `${versLeChapeau};scale:.4;opacity:1`],
      [T_TENUE, `${versLeChapeau};scale:.3;opacity:0`],
      [100, `${versLeChapeau};scale:.3;opacity:0`]
    ],
    D_TRACE,
    { courbe: 'ease-in' }
  )
}
/** Le chiffre du chapeau s'embrase quand le glyphe l'atteint. */
const eclairDuChapeau = (f: Feuille): string =>
  f.anim(
    [
      [0, 'scale:.6;opacity:0'],
      [T_TENUE - 2, 'scale:.6;opacity:0'],
      [T_TENUE + 1, 'scale:1.4;opacity:1'],
      [T_TENUE + 16, 'scale:1;opacity:0'],
      [100, 'opacity:0']
    ],
    D_TRACE
  )

/** Un chiffre seul : la pointe part du début du chiffre, l'écrit, s'attarde, puis y revient. */
function tracer(
  f: Feuille,
  valeur: string
): { joints: readonly [string, string]; dessin: string; ecart: number } {
  const traits = traitsDuChiffre(valeur)
  const { cibles: ecriture, traces, fin } = planifier(traits, 3, T_FIN)
  const debut = ecriture[0][1]
  const cibles: Cible[] = [[0, debut], ...ecriture, ...revenir(fin, debut)]
  const { joints, ecart } = resoudre(f, S_R, U_R, F_BAG, cibles, preferD, D_TRACE)
  return {
    joints,
    ecart,
    dessin: `<g class="${volVersLeChapeau(f, G)}">${encrer(f, traits, traces)}</g>`
  }
}

/**
 * DEUX CHIFFRES, DEUX BRAS QUI SE RELAIENT (conv-1270). Un bras par chiffre et par place ne peut
 * pas savoir quel chiffre l'autre écrit : 90 nombres n'ont donc pas 90 bras, mais 19 (9 dizaines,
 * 10 unités). Le bras de la dizaine part du haut de la dizaine (`ATTENTE`), l'écrit, puis va au
 * centre de la paire (`RELAIS`) à `T_RELAIS` ; celui de l'unité y prend la main, l'écrit, s'attarde,
 * et revient à `ATTENTE` pour le cycle suivant. Aux deux passages de main, les deux bras sont dans la
 * MÊME pose (même cible) : la bascule de l'un à l'autre (`VISIBLE`) ne se voit pas, ce que vérifie
 * l'écart « relais » du test.
 */
const T_RELAIS = 31
const RELAIS: Pt = G2
const ATTENTE: Pt = [r2(G2[0] - ECART_DEUX * ECHELLE_TRACE), r2(G2[1] - 8 * K_DEUX * ECHELLE_TRACE)]
const VISIBLE: Record<Place, readonly Image[]> = {
  d: [
    [0, 'opacity:1'],
    [T_RELAIS - 0.1, 'opacity:1'],
    [T_RELAIS, 'opacity:0'],
    [100, 'opacity:0']
  ],
  u: [
    [0, 'opacity:0'],
    [T_RELAIS - 0.1, 'opacity:0'],
    [T_RELAIS, 'opacity:1'],
    [100, 'opacity:1']
  ]
}
type Angles = (t: number) => readonly [number, number]
function tracerALaPlace(
  f: Feuille,
  chiffre: string,
  place: Place
): {
  joints: readonly [string, string]
  encres: string
  visible: string
  ecart: number
  angles: Angles
} {
  const traits = traitsALaPlace(chiffre, place)
  let cibles: Cible[]
  let traces: readonly Trace[]
  if (place === 'd') {
    const p = planifier(traits, 0, T_RELAIS, ATTENTE, RELAIS)
    cibles = [...p.cibles, [100, RELAIS]]
    traces = p.traces
  } else {
    const p = planifier(traits, T_RELAIS, T_FIN, RELAIS)
    cibles = [[0, RELAIS], ...p.cibles, ...revenir(p.fin, ATTENTE)]
    traces = p.traces
  }
  const { joints, ecart, angles } = resoudre(f, S_R, U_R, F_BAG, cibles, preferD, D_TRACE)
  return {
    joints,
    ecart,
    angles,
    encres: encrer(f, traits, traces),
    visible: f.anim(VISIBLE[place], D_TRACE, { courbe: 'linear' })
  }
}
/**
 * L'écart du relais, en pixels : la plus grande distance, coude ou pointe, entre le bras qui rend la
 * main et celui qui la prend, à `T_RELAIS` et au tour du cycle, pour toutes les paires de chiffres.
 */
function ecartDuRelais(
  dizaines: ReadonlyArray<{ angles: Angles }>,
  unites: ReadonlyArray<{ angles: Angles }>
): number {
  const pose = ([a1, a2]: readonly [number, number]): readonly [Pt, Pt] => {
    const u = tourner(U_R, a1)
    return [[S_R[0] + u[0], S_R[1] + u[1]], main(S_R, U_R, F_BAG, a1, a2)]
  }
  const distance = (a: readonly [Pt, Pt], b: readonly [Pt, Pt]): number =>
    Math.max(...[0, 1].map((i) => Math.hypot(a[i][0] - b[i][0], a[i][1] - b[i][1])))
  let ecart = 0
  for (const d of dizaines)
    for (const u of unites)
      ecart = Math.max(
        ecart,
        distance(pose(d.angles(T_RELAIS)), pose(u.angles(T_RELAIS))),
        distance(pose(u.angles(100)), pose(d.angles(0)))
      )
  return ecart
}

// ---------------- « Au travail » : ce que tout le reste fait en même temps ----------------
/**
 * L'INVOCATION DE LA MAIN GAUCHE (conv-1227, 2026-10-28, « l'autre main fait apparaître des trucs
 * comme ce screenshot » : une main ouverte, une sphère d'énergie au-dessus, des cercles magiques
 * empilés en perspective, des colonnes de runes qui montent, des éclats de cristal). Elle remplace
 * la boule pétrie puis lancée en boule de feu. Même cycle que le tracé (`D_TRACE`) : la sphère
 * culmine quand le chiffre écrit file au chapeau, au moment où les yeux s'allument (`visage`).
 * Depuis conv-1258, des étoiles en orbite tiennent la place des cercles (`ORBITE`).
 */
const POIGNET: Pt = [-10, 43.5]
/** La sphère flotte au-dessus de la paume. */
const SPHERE: Pt = [-14, 27]
/**
 * LES ÉTOILES EN ORBITE (conv-1258, /draft, « Implémenter la 3 · Étoiles en orbite ») : trois
 * étoiles d'or tournent autour de la sphère, passent devant puis derrière elle, et plongent dedans
 * au sommet du sort. Elles remplacent les trois cercles magiques empilés en perspective, qui à
 * taille réelle ne se lisaient que comme trois barres rose, or et cyan au-dessus de la main.
 * L'orbite : une ellipse de `rx` × `ry` px inclinée de `inclinaison` degrés, un tour en `tour`
 * secondes, les trois étoiles à un tiers de tour l'une de l'autre.
 */
const ORBITE = { rx: 14.5, ry: 5.5, inclinaison: -12, tour: 1.8 } as const
const ETOILE_D_OR = `<path d="M0-4.6L1.15-1.15 4.6 0 1.15 1.15 0 4.6-1.15 1.15-4.6 0-1.15-1.15Z" fill="${OR}"/><circle r="1.2" fill="#fff"/>`
/** Le poignet, en % du cycle : il s'abaisse, monte avec la sphère, la pousse au sommet, redescend. */
const GESTE_INVOCATION: ReadonlyArray<readonly [number, Pt]> = [
  [0, POIGNET],
  [8, [-9.6, 44.6]],
  [56, [-11, 41.2]],
  [64, [-12.2, 39.6]],
  [80, [-11.6, 40.2]],
  [93, [-10.2, 43.2]],
  [100, POIGNET]
]
/** Le coude gauche en bas : la main tenue paume en l'air, comme on porte un plateau. */
const coudeEnBas = (_ex: number, ey: number): number => ey

function invocation(f: Feuille): { bras: string; derriere: string; devant: string; ecart: number } {
  const T = D_TRACE
  const { joints, ecart, droit } = resoudre(f, S_L, U_L, F_L, GESTE_INVOCATION, coudeEnBas, T)
  const tenue = `<g transform="translate(${F_L[0]} ${F_L[1]})"><g class="jt ${droit()}">${MAIN_OUVERTE}</g></g>`
  const brasGauche = bras(S_L, U_L, F_L, joints, tenue, 2)
  // La sphère et ses étoiles suivent la main (mêmes instants, même interpolation linéaire).
  const suit = f.anim(
    GESTE_INVOCATION.map(
      ([t, [x, y]]) => [t, `translate:${r2(x - POIGNET[0])}px ${r2(y - POIGNET[1])}px`] as const
    ),
    T,
    { courbe: 'linear' }
  )
  const grandit = f.anim(
    [
      [0, 'scale:.4'],
      [10, 'scale:.4'],
      [58, 'scale:1'],
      [64, 'scale:1.3'],
      [80, 'scale:1.1'],
      [92, 'scale:.5'],
      [100, 'scale:.4']
    ],
    T
  )
  const eclair = f.anim(
    [
      [0, 'opacity:0'],
      [61, 'opacity:0'],
      [65, 'opacity:1'],
      [76, 'opacity:0'],
      [100, 'opacity:0']
    ],
    T
  )
  const crepite = f.anim(
    [
      [0, 'opacity:1'],
      [50, 'opacity:.15'],
      [100, 'opacity:1']
    ],
    0.24,
    { courbe: 'steps(2)' }
  )
  const tourne = (duree: number, sens: 1 | -1): string =>
    f.anim(
      [
        [0, 'rotate:0deg'],
        [100, `rotate:${360 * sens}deg`]
      ],
      duree,
      { courbe: 'linear' }
    )
  const sphere =
    '<circle r="11" fill="url(#gSv)"/><circle r="7" fill="url(#oS)"/>' +
    `<g transform="scale(1 .45)"><g class="${tourne(1.2, 1)}"><circle r="9.5" stroke="${CYAN}" stroke-width="1.2" stroke-dasharray="14 46" fill="none"/></g></g>` +
    `<g transform="rotate(-35) scale(1 .45)"><g class="${tourne(1.5, -1)}"><circle r="9" stroke="${ROSE}" stroke-width="1.1" stroke-dasharray="12 44" fill="none"/></g></g>` +
    `<g transform="scale(1.3)"><g class="${crepite}"><path d="M-3.2-.8l-1.6 1.6 1.2.6-2 1.8M3.2-.8l1.6 1.6-1.2.6 2 1.8M-.8-3.2l1-2 .8 1 .8-2" stroke="#f3eeff" stroke-width=".6" fill="none"/></g></g>` +
    `<g class="${eclair}"><circle r="12" fill="url(#gFl)"/></g>`
  // Les étoiles naissent avec la sphère, plongent dedans à son sommet (l'éclair, à 64 %), et en
  // ressortent un instant quand elle retombe. La ronde se resserre sur le centre de la sphère (`jt`).
  const ronde = f.anim(
    [
      [0, 'scale:.3;opacity:0'],
      [8, 'scale:.3;opacity:0'],
      [18, 'scale:.95;opacity:1'],
      [58, 'scale:1;opacity:1'],
      [66, 'scale:0;opacity:0'],
      [80, 'scale:0;opacity:0'],
      [92, 'scale:.8;opacity:1'],
      [100, 'scale:.3;opacity:0']
    ],
    T
  )
  // Un tour d'orbite, sur 12 points de l'ellipse : devant (moitié basse), l'étoile est plus grande et
  // plus vive ; derrière, plus petite et plus pâle.
  const orbite = Array.from({ length: 13 }, (_, i): Image => {
    const a = (i / 12) * 2 * Math.PI
    const [x, y] = tourner([ORBITE.rx * Math.cos(a), ORBITE.ry * Math.sin(a)], ORBITE.inclinaison)
    const avant = Math.sin(a)
    return [
      (i / 12) * 100,
      `translate:${r2(x)}px ${r2(y)}px;scale:${r2(0.85 + 0.3 * avant)};opacity:${r2(0.75 + 0.25 * avant)}`
    ]
  })
  // Pour passer VRAIMENT devant puis derrière la sphère, chaque étoile a deux copies, une de chaque
  // côté d'elle, et une seule se montre à la fois : la première moitié du tour (0 à 50 %) est
  // devant. La bascule tombe aux deux bouts de l'ellipse, à 14,5 px du centre, hors de la sphère.
  const etoiles = (devant: boolean): string =>
    [0, 1, 2]
      .map((k) => {
        const delai = r2((k * ORBITE.tour) / 3)
        const cote = f.anim(
          [
            [0, `opacity:${devant ? 1 : 0}`],
            [50, `opacity:${devant ? 0 : 1}`],
            [100, `opacity:${devant ? 0 : 1}`]
          ],
          ORBITE.tour,
          { delai, courbe: 'step-end' }
        )
        const tour = f.anim(orbite, ORBITE.tour, { delai, courbe: 'linear' })
        return `<g class="${tour}"><g class="${cote} ${lueurDe(OR)}">${ETOILE_D_OR}</g></g>`
      })
      .join('')
  const enRonde = (devant: boolean): string =>
    `<g transform="translate(${SPHERE[0]} ${SPHERE[1]})"><g class="jt ${ronde}">${etoiles(devant)}</g></g>`
  // Les colonnes de runes qui montaient au-dessus de la main ont été retirées (conv-1227, « les
  // ronds qui montent c'est trop, enlève-les ») : à la vraie taille, leurs runes ne se lisaient que
  // comme des points de couleur qui grimpaient.
  // Des éclats de cristal, roses et cyan, qui montent en tournant autour de la main.
  const eclatCristal = (x: number, y: number, dx: number, couleur: string, delai: number): string =>
    placer(
      x,
      y,
      `<path d="M0-2.2L1.1 0 0 2.2-1.1 0Z" fill="${couleur}" fill-opacity=".9"/>`,
      f.anim(
        [
          [0, 'translate:0 0;rotate:0deg;opacity:0'],
          [15, 'opacity:1'],
          [70, 'opacity:.9'],
          [100, `translate:${dx}px -20px;rotate:200deg;opacity:0`]
        ],
        2.2,
        { delai, courbe: 'ease-out' }
      )
    )
  const eclats =
    eclatCristal(-22, 46, -3, ROSE, 0) +
    eclatCristal(-6, 45, 3, CYAN, 0.45) +
    eclatCristal(-18, 40, -4, CYAN, 0.9) +
    eclatCristal(-9, 38, 2, ROSE, 1.35) +
    eclatCristal(-25, 36, -2, ROSE, 1.8) +
    eclatCristal(-3, 41, 4, '#fff3c4', 1.1)
  const derriere = `<g class="${suit}">${enRonde(false)}${placer(SPHERE[0], SPHERE[1], sphere, grandit)}${enRonde(true)}</g>`
  return { bras: brasGauche, derriere, devant: eclats, ecart }
}

/**
 * Une page du grimoire à l'angle `a` (0 = couchée à droite, 180 = couchée à gauche), vue de trois
 * quarts : elle tourne autour de la reliure (le segment x = 26, de y 57,6 à 63), se SOULÈVE
 * au-dessus d'elle (`LEVE`) et se cambre en route (`CAMBRE`), comme une vraie feuille. À 0° et à
 * 180°, elle se confond avec la page couchée de son côté. Toujours le même tracé (Q, L, Q) : la
 * propriété CSS `d` passe d'une image à l'autre.
 */
const LEVE = 0.72
const CAMBRE = 3.5
/**
 * Une feuille couchée à droite de la reliure, décrite par : le haut et le bas de la reliure, sa
 * largeur, le haut et la hauteur de son bord libre, et le haut et le bas de ses courbes.
 */
type Feuillet = {
  haut: number
  bas: number
  largeur: number
  bord: number
  hauteur: number
  courbeHaut: number
  courbeBas: number
}
const PAGE: Feuillet = {
  haut: 57.6,
  bas: 63,
  largeur: 15,
  bord: 56.6,
  hauteur: 5.6,
  courbeHaut: 54.2,
  courbeBas: 59.8
}
/**
 * La couverture de dessus, qui ferme le livre : la moitié droite de la couverture, soulevée de
 * 1,5 px (l'épaisseur des pages, qu'on voit dépasser dessous).
 */
const COUVERTURE: Feuillet = {
  haut: 55.1,
  bas: 63.3,
  largeur: 16.6,
  bord: 54.7,
  hauteur: 7.6,
  courbeHaut: 51.5,
  courbeBas: 59.7
}
function feuilleTournee(a: number, g: Feuillet): string {
  const c = Math.cos((a * Math.PI) / 180)
  const s = Math.sin((a * Math.PI) / 180)
  const bord: Pt = [26 + g.largeur * c, g.bord - g.largeur * LEVE * s]
  const cx = 26 + 7 * c + CAMBRE * s
  return (
    `M26 ${g.haut}Q${r2(cx)} ${r2(g.courbeHaut - 7 * LEVE * s)} ${r2(bord[0])} ${r2(bord[1])}` +
    `L${r2(bord[0])} ${r2(bord[1] + g.hauteur)}Q${r2(cx)} ${r2(g.courbeBas - 7 * LEVE * s)} 26 ${g.bas}Z`
  )
}
const pageTournee = (a: number): string => feuilleTournee(a, PAGE)
/** La couverture : violette dehors, plus sombre vue par la tranche, nuit dedans. */
function teinteDeCouverture(a: number): string {
  const u = a / 180
  const melange = (dehors: number, dedans: number): string =>
    Math.round(dehors + (dedans - dehors) * u)
      .toString(16)
      .padStart(2, '0')
  return `#${melange(0x6a, 0x2a)}${melange(0x46, 0x17)}${melange(0xcc, 0x66)}`
}
/** Le papier s'assombrit quand la page est vue par la tranche, et s'éclaire couché. */
function teinteDePage(a: number): string {
  const ombre = Math.sin((a * Math.PI) / 180)
  const melange = (clair: number, sombre: number): string =>
    Math.round(clair + (sombre - clair) * ombre)
      .toString(16)
      .padStart(2, '0')
  return `#${melange(0xff, 0xd8)}${melange(0xf8, 0xbf)}${melange(0xea, 0x86)}`
}

/**
 * LE GRIMOIRE (conv-1227, 2026-10-28, « remplace les 3 boules en dessous par un grimoire ») : à la
 * place des trois pantins, un livre ouvert flotte sous la bille ; une lueur monte des pages, et des
 * étincelles s'en échappent. `lueur` et `encre` disent l'état (bleu au travail, or pour toi).
 *
 * LES PAGES SE TOURNENT TOUTES SEULES (conv-1227, « les pages du grimoire doivent se tourner toutes
 * seules ») : la page d'avant, aplatie en largeur, restait dans le plan du livre et ne se voyait pas
 * tourner (constaté en capture). Trois pages se soulèvent maintenant l'une après l'autre, se dressent
 * au-dessus de la reliure en se cambrant, et retombent à gauche : une toutes les `feuillette`
 * secondes, deux en l'air à la fois.
 */
function grimoire(
  f: Feuille,
  lueur: string,
  encre: string,
  feuillette: number,
  ouverture = false
): string {
  const flotte = f.anim(
    [
      [0, 'translate:0 -.8px'],
      [50, 'translate:0 1px'],
      [100, 'translate:0 -.8px']
    ],
    2.2
  )
  // Une page : couchée à droite (0-8 %), elle tourne (8-72 %, lente au départ et à l'arrivée),
  // reste couchée à gauche (72-80 %), puis s'efface sous la page gauche, qui a le même dessin.
  const lisse = (u: number): number => u * u * (3 - 2 * u)
  const etape = (a: number, opacite: number): string =>
    `d:path("${pageTournee(a)}");fill:${teinteDePage(a)};opacity:${opacite}`
  const imagesDePage: Image[] = [
    [0, etape(0, 0)],
    [2, etape(0, 1)],
    ...Array.from(
      { length: 13 },
      (_, k) => [8 + (64 * k) / 12, etape(180 * lisse(k / 12), 1)] as const
    ),
    [80, etape(180, 1)],
    [81, etape(180, 0)],
    [100, etape(180, 0)]
  ]
  const pages = [0, 1, 2]
    .map(
      (k) =>
        `<path class="${f.anim(imagesDePage, 3 * feuillette, { delai: r2(k * feuillette), courbe: 'linear' })}" d="${pageTournee(0)}" fill="${teinteDePage(0)}" stroke="#b8955a" stroke-width=".35"/>`
    )
    .join('')
  const respire = f.anim(
    [
      [0, 'opacity:.55'],
      [50, 'opacity:1'],
      [100, 'opacity:.55']
    ],
    1.4
  )
  const etincelle = (x: number, delai: number): string =>
    placer(
      x,
      56,
      `<circle r=".75" fill="${encre}"/>`,
      f.anim(
        [
          [0, 'translate:0 0;opacity:0'],
          [20, 'opacity:1'],
          [100, 'translate:0 -9px;opacity:0']
        ],
        1.3,
        { delai, courbe: 'ease-out' }
      )
    )
  const vivant =
    `<g class="${respire}"><ellipse cx="26" cy="57" rx="13" ry="5.5" fill="url(#${lueur})"/></g>` +
    // Les pages qui tournent passent PAR-DESSUS la lueur : elle les noierait.
    pages +
    etincelle(19, 0) +
    etincelle(26, 0.45) +
    etincelle(33, 0.9)
  if (!ouverture)
    return `<g class="grim ${flotte}">${MOITIE_GAUCHE}${MOITIE_DROITE}${RELIURE}${vivant}</g>`
  // L'OUVERTURE (conv-1227, « fermé au calme, qui s'ouvre quand un agent se met au travail ») :
  // jouée une fois, chaque fois que le travail commence. Au départ, c'est le grimoire fermé du
  // calme (`grimoireFerme`) ; la couverture bascule par-dessus la reliure pendant que le livre glisse
  // de 8 px vers la droite pour rester centré ; la moitié gauche apparaît sous la couverture qui se
  // pose, puis la lueur, les étincelles et les pages qui tournent.
  const D = 1.1
  const une = { une: true, courbe: 'linear' }
  const glisse = f.anim(
    [
      [0, 'translate:-8px 0'],
      [15, 'translate:-8px 0'],
      [75, 'translate:0 0'],
      [100, 'translate:0 0']
    ],
    D,
    { une: true }
  )
  const rabat = f.anim(
    [
      ...Array.from(
        { length: 11 },
        (_, k) => [15 + 6 * k, etapeCouverture(180 * lisse(k / 10), 1)] as const
      ),
      [78, etapeCouverture(180, 1)],
      [80, etapeCouverture(180, 0)],
      [100, etapeCouverture(180, 0)]
    ],
    D,
    une
  )
  const apparait = (debut: number, fin: number): string =>
    f.anim(
      [
        [0, 'opacity:0'],
        [debut, 'opacity:0'],
        [fin, 'opacity:1'],
        [100, 'opacity:1']
      ],
      D,
      une
    )
  const etoileQuiPart = f.anim(
    [
      [0, 'opacity:1'],
      [22, 'opacity:0'],
      [100, 'opacity:0']
    ],
    D,
    une
  )
  return (
    `<g class="grim ${flotte}"><g class="${glisse}">` +
    `<g class="${apparait(74, 78)}">${MOITIE_GAUCHE}</g>${MOITIE_DROITE}${RELIURE}` +
    `<g class="${apparait(78, 92)}">${vivant}</g>` +
    `<path class="${rabat}" d="${feuilleTournee(0, COUVERTURE)}" fill="${teinteDeCouverture(0)}" stroke="${OR}" stroke-width=".5"/>` +
    `<g class="${etoileQuiPart}">${ETOILE_DE_COUVERTURE}</g>` +
    '</g></g>'
  )
}
const etapeCouverture = (a: number, opacite: number): string =>
  `d:path("${feuilleTournee(a, COUVERTURE)}");fill:${teinteDeCouverture(a)};opacity:${opacite}`

// Le grimoire ouvert, en deux moitiés : la gauche n'apparaît qu'une fois la couverture rabattue.
const lignesDePage = (cote: 1 | -1): string =>
  [0, 1, 2]
    .map((i) => {
      const y = r2(58.7 + i * 1.4)
      const yc = r2(55.9 + i * 1.4)
      const yb = r2(57.9 + i * 1.4)
      return `M${26 + 2 * cote} ${y}Q${26 + 7 * cote} ${yc} ${26 + 13 * cote} ${yb}`
    })
    .join('')
const lignes = (cote: 1 | -1): string =>
  `<path d="${lignesDePage(cote)}" stroke="#a88b5c" stroke-width=".45" stroke-opacity=".8" fill="none"/>`
const MOITIE_GAUCHE =
  `<path d="M26 56.6Q19 53 9.4 56.2L9.4 63.8Q19 61.2 26 64.8Z" fill="url(#gCv)" stroke="${OR}" stroke-width=".5"/>` +
  '<path d="M26 63Q19 59.8 11 62.2L11 63Q19 60.6 26 64Z" fill="#e2cf9f"/>' +
  '<path d="M26 57.6Q19 54.2 11 56.6L11 62.2Q19 59.8 26 63Z" fill="url(#gPg)"/>' +
  lignes(-1)
const COUVERTURE_DROITE = `<path d="M26 56.6Q33 53 42.6 56.2L42.6 63.8Q33 61.2 26 64.8Z" fill="url(#gCv)" stroke="${OR}" stroke-width=".5"/>`
const TRANCHE_DROITE = '<path d="M26 63Q33 59.8 41 62.2L41 63Q33 60.6 26 64Z" fill="#e2cf9f"/>'
const MOITIE_DROITE =
  COUVERTURE_DROITE +
  TRANCHE_DROITE +
  '<path d="M26 57.6Q33 54.2 41 56.6L41 62.2Q33 59.8 26 63Z" fill="url(#gPg)"/>' +
  lignes(1)
const RELIURE = '<path d="M26 57.6V63" stroke="#c9a86a" stroke-width=".4"/>'
/** L'étoile d'or sur la couverture fermée, au milieu de la moitié droite. */
const ETOILE_DE_COUVERTURE = `<path d="${etoile(34.2, 58.4, 2.6)}" fill="${OR}" stroke="#fff3c4" stroke-width=".3"/>`

/**
 * LE GRIMOIRE FERMÉ, au calme (conv-1227, « affiche aussi le grimoire au calme, fermé ») : la
 * moitié droite du livre et sa couverture rabattue, une étoile d'or qui luit doucement ; décalé de
 * 8 px vers la gauche pour être centré sous la bille. C'est exactement la première image de
 * l'ouverture (`grimoire`, au travail) : le livre fermé du calme est celui qui s'ouvre.
 */
function grimoireFerme(f: Feuille): string {
  const flotte = f.anim(
    [
      [0, 'translate:0 -.8px'],
      [50, 'translate:0 1px'],
      [100, 'translate:0 -.8px']
    ],
    2.2
  )
  const luit = f.anim(
    [
      [0, 'opacity:.55'],
      [50, 'opacity:1'],
      [100, 'opacity:.55']
    ],
    3.2
  )
  return (
    `<g class="grim ${flotte}"><g transform="translate(-8 0)">` +
    COUVERTURE_DROITE +
    TRANCHE_DROITE +
    `<path d="${feuilleTournee(0, COUVERTURE)}" fill="${teinteDeCouverture(0)}" stroke="${OR}" stroke-width=".5"/>` +
    `<g class="${luit}"><g class="${lueurDe(OR)}">${ETOILE_DE_COUVERTURE}</g></g>` +
    '</g></g>'
  )
}

/**
 * Les symboles qui se tracent autour du personnage au travail : [x, y, tracé, couleur du halo], dans
 * le repère de la bille. Tous tiennent dans la fenêtre, hors de la bande des cartes (RETRAIT_COTE).
 */
const SYMBOLES: ReadonlyArray<readonly [number, number, string, string]> = [
  // Triangle à l'œil, en haut à gauche.
  [-21, -14, 'M0-5L4.6 3.2H-4.6ZM-1.8.6Q0-1.2 1.8.6Q0 2.4-1.8.6', CYAN],
  // Croissant de lune, au-dessus de l'épaule gauche du chapeau.
  [-2, -27, 'M1.6-4.6A5 5 0 1 0 1.6 4.6A3.6 3.6 0 1 1 1.6-4.6Z', ROSE],
  // Pentacle tracé d'un seul trait, à droite de la pointe du chapeau.
  [52, -30, 'M0-5L2.9 4L-4.8-1.5H4.8L-2.9 4Z', OR],
  // Cercle croisé, en haut à droite.
  [71, -14, 'M0-4.2A4.2 4.2 0 1 1 0 4.2A4.2 4.2 0 1 1 0-4.2M0-6V6M-6 0H6', CYAN],
  // Rune flèche, en bas à gauche, sous l'invocation.
  [-23, 54, 'M0 5V-5M-3-2L0-5 3-2M-3 1L0-2 3 1', OR],
  // Triangle barré (le signe alchimique de l'air), sous le grimoire à gauche.
  [-6, 68, 'M-4.4 3.4L0-4.4 4.4 3.4ZM-2.6.4H2.6', ROSE],
  // Spirale, en bas à droite.
  [62, 62, 'M0 0Q1.6-1.4 1.6.6Q1.2 3-1.4 2.6Q-4 1.6-3.4-1.6Q-2.4-4.6 1.4-4.4Q5-3.6 4.8.6', CYAN]
]

function auTravail(f: Feuille): {
  gauche: string
  invocation: string
  follets: string
  marges: string
  grimoire: string
  ecart: number
} {
  const main = invocation(f)
  // Trois feux follets en orbite : ils s'effacent quand ils passent derrière la bille.
  const orbite = (delai: number): string => {
    const images: Image[] = []
    for (let i = 0; i <= 16; i++) {
      const a = (2 * Math.PI * i) / 16
      const x = 35 * Math.cos(a)
      const y = 13 * Math.sin(a)
      const devant = (Math.sin(a) + 1) / 2
      const derriere = Math.sin(a) < -0.05 && Math.abs(x) < 27
      images.push([
        (i * 100) / 16,
        `translate:${r2(x)}px ${r2(y)}px;scale:${r2(0.55 + 0.45 * devant)};opacity:${derriere ? 0 : r2(0.35 + 0.65 * devant)}`
      ])
    }
    return f.anim(images, 3, { delai, courbe: 'linear' })
  }
  const follets = [0, 1, 2].map((i) => placer(26, 30, peint('mFo'), orbite(i))).join('')
  // En marge, à droite (la gauche est à l'invocation) : une note et une rune qui montent et se tracent.
  const monte = (delai: number): string =>
    f.anim(
      [
        [0, 'translate:0 4px;opacity:0'],
        [12, 'opacity:1'],
        [60, 'translate:0 -12px;opacity:0'],
        [100, 'translate:0 -12px;opacity:0']
      ],
      2,
      { delai, courbe: 'ease-out' }
    )
  const ecrit = (delai: number): string =>
    f.anim(
      [
        [0, 'stroke-dashoffset:30;opacity:1'],
        [45, 'stroke-dashoffset:0;opacity:1'],
        [70, 'stroke-dashoffset:0;opacity:1'],
        [85, 'stroke-dashoffset:0;opacity:0'],
        [100, 'stroke-dashoffset:30;opacity:0']
      ],
      1.6,
      { delai, courbe: 'linear' }
    )
  // `pathLength="30"` : chaque symbole se trace en entier avec le même pointillé, quelle que soit sa
  // longueur réelle.
  const rune = (d: string, classe: string, halo = '#ff6ad5'): string =>
    `<g transform="scale(1.2)"><g class="${classe}"><path d="${d}" pathLength="30" stroke="${halo}" stroke-opacity=".35" stroke-width="3" stroke-dasharray="30" fill="none"/><path d="${d}" pathLength="30" stroke="#fff" stroke-width="1" stroke-dasharray="30" fill="none"/></g></g>`
  /**
   * DES SYMBOLES QUI SE TRACENT TOUT AUTOUR (conv-1227, « mets des symboles qui se dessinent comme
   * ce losange un peu partout autour ») : le losange de la marge droite a sept frères, posés en
   * couronne autour du personnage, hors de l'invocation (à gauche) et du chiffre écrit (à droite).
   * Chacun se trace trait par trait, tient, puis s'efface ; leurs départs sont décalés pour qu'il y
   * en ait toujours deux ou trois en train de s'écrire.
   */
  const ecritLent = (delai: number): string =>
    f.anim(
      [
        [0, 'stroke-dashoffset:30;opacity:1'],
        [35, 'stroke-dashoffset:0;opacity:1'],
        [70, 'stroke-dashoffset:0;opacity:1'],
        [85, 'stroke-dashoffset:0;opacity:0'],
        [100, 'stroke-dashoffset:30;opacity:0']
      ],
      3.2,
      { delai, courbe: 'linear' }
    )
  const symboles = SYMBOLES.map(([x, y, d, halo], i) =>
    placer(x, y, rune(d, ecritLent(r2((i * 3.2) / SYMBOLES.length)), halo))
  ).join('')
  const marges =
    placer(75, 52, peint('mNo'), monte(1.4)) +
    placer(71, 8, rune('M0-5L4 0 0 5-4 0ZM-4 0H-6M4 0H6', ecrit(0.8))) +
    symboles
  return {
    gauche: main.bras + main.devant,
    invocation: main.derriere,
    follets,
    marges,
    grimoire: grimoire(f, 'gGb', CYAN, 0.7, true),
    ecart: main.ecart
  }
}

// ---------------- « Pour toi » ----------------
function pourToi(f: Feuille): { bras: string; fete: string; eclair: string; ecart: number } {
  const g = resoudre(
    f,
    S_L,
    U_L,
    F_L,
    [
      [0, [-3, 12]],
      [50, [-7, 16]],
      [100, [-3, 12]]
    ],
    preferG,
    0.8,
    { courbe: 'ease-in-out' }
  )
  const d = resoudre(
    f,
    S_R,
    U_R,
    F_BAG,
    [
      [0, [58, 6]],
      [50, [63, 10]],
      [100, [58, 6]]
    ],
    preferD,
    0.8,
    { courbe: 'ease-in-out', delai: 0.2 }
  )
  // Les feux follets filent dans le chiffre, une comète part de la baguette : il s'embrase à 60 %.
  const fusion = (x: number, y: number): string =>
    f.anim(
      [
        [0, `translate:${x}px ${y}px;scale:1;opacity:1`],
        [60, 'translate:0 0;scale:.25;opacity:1'],
        [64, 'translate:0 0;scale:.25;opacity:0'],
        [100, `translate:${x}px ${y}px;scale:1;opacity:0`]
      ],
      2.2
    )
  const comete = f.anim(
    [
      [0, 'translate:35px 9px;scale:.4;opacity:0'],
      [30, 'translate:35px 9px;scale:.9;opacity:1'],
      [60, 'translate:0 0;scale:.3;opacity:1'],
      [63, 'translate:0 0;scale:.3;opacity:0'],
      [100, 'opacity:0']
    ],
    2.2,
    { courbe: 'ease-in' }
  )
  const eclair = f.anim(
    [
      [0, 'scale:.6;opacity:0'],
      [58, 'scale:.6;opacity:0'],
      [64, 'scale:1.35;opacity:1'],
      [86, 'scale:1;opacity:0'],
      [100, 'opacity:0']
    ],
    2.2
  )
  const eclate = f.anim(
    [
      [0, 'scale:1;opacity:1'],
      [22, 'scale:1.35;opacity:1'],
      [30, 'scale:0;opacity:0'],
      [88, 'scale:0;opacity:0'],
      [100, 'scale:1;opacity:1']
    ],
    1.8
  )
  const gerbe = f.anim(
    [
      [0, 'scale:.3;opacity:0'],
      [32, 'scale:.3;opacity:0'],
      [42, 'scale:1;opacity:1'],
      [72, 'scale:1.6;opacity:0'],
      [100, 'scale:1.6;opacity:0']
    ],
    1.8
  )
  const pluie = (x: number, delai: number): string =>
    placer(
      x,
      -28,
      peint('mEc', 2.2),
      f.anim(
        [
          [0, 'translate:0 0;rotate:0deg;opacity:0'],
          [10, 'opacity:1'],
          [80, 'translate:0 34px;rotate:180deg;opacity:.9'],
          [100, 'translate:0 40px;rotate:220deg;opacity:0']
        ],
        1.6,
        { delai, courbe: 'linear' }
      )
    )
  const tourne = f.anim(
    [
      [0, 'rotate:0deg'],
      [100, 'rotate:360deg']
    ],
    4,
    { courbe: 'linear' }
  )
  const fete =
    `<g transform="translate(26 62) scale(1.5 .42)"><g class="${tourne}">${peint('mSc')}</g></g>` +
    placer(26, 46, '<circle r="8" fill="url(#gGo)"/><circle r="3.2" fill="url(#oA)"/>', eclate) +
    placer(-8, 13, peint('mGe'), gerbe) +
    placer(-14, 34, peint('mGe'), gerbe) +
    pluie(-12, 0) +
    pluie(-2, 0.6) +
    pluie(56, 0.3) +
    pluie(70, 1) +
    // Le grimoire, en or : ses pages tournent vite (conv-1227, à la place des pantins qui sautaient).
    grimoire(f, 'gGo', OR, 0.4) +
    (
      [
        [-34, 33],
        [36, 33],
        [-30, 52]
      ] as const
    )
      .map(([x, y]) => placer(25, -3, peint('mFo'), fusion(x, y)))
      .join('') +
    placer(25, -3, peint('mFg', 0.8), comete)
  const brasLeves = bras(S_L, U_L, F_L, g.joints) + bras(S_R, U_R, F_R, d.joints, baguette('oA'))
  return { bras: brasLeves, fete, eclair, ecart: Math.max(g.ecart, d.ecart) }
}

// ---------------- Le glyphe : le cercle magique qui tourne autour de la bille ----------------
/**
 * LE GLYPHE DU HALO (conv-1227, 2026-10-28, « le rond qui tourne autour je le veux plus gros et ça
 * doit être une glyphe ») : le halo n'était qu'un cercle pointillé à 4 px de la bille. C'est
 * maintenant un cercle magique de 92 px, DERRIÈRE le personnage : une couronne de runes (`.ge`) qui
 * tourne dans un sens, une étoile à six branches cerclée de points (`.gi`) qui tourne dans l'autre.
 * Tout est en `currentColor` : l'état choisit sa couleur et ses mouvements (`cssDeLEtat`).
 * Repère : le carré du halo (64 px, 1 unité = 1 px), centre en (32, 32) ; le glyphe en déborde.
 */
export const RAYON_GLYPHE = 46
/** Des runes à traits droits, debout, dans une boîte d'environ 2,4 × 3,4 centrée sur 0. */
const RUNES = [
  'M-.8 1.7V-1.7M-.8-1.7L.9-.8M-.8-.4L.9.5',
  'M-.8 1.7V-1.7L.8-.9L-.8 0L.9 1.7',
  'M0 1.7V-1.7M-1.1-1.4L0 0L1.1-1.4',
  'M-1.1 1.7L.9-.5L0-1.7L-.9-.5L1.1 1.7',
  'M-.7 1.7V-1.7M-.7-.9L.7 0L-.7.9',
  'M-1 1.7V-1.7L1 .3M1 1.7V-1.7L-1 .3',
  'M0 1.7V-1.7M-1.1-.6L0-1.7L1.1-.6',
  'M-.9-1.7L.9-.6L-.9.6L.9 1.7'
]
export function glypheDuHalo(): string {
  const c = 32
  const R = RAYON_GLYPHE
  const interieur = R - 5.4
  const bande = (R + interieur) / 2
  const n = 24
  const couronne = Array.from({ length: n }, (_, i) => {
    // Un losange plein aux quatre points cardinaux, une rune partout ailleurs.
    const noeud = i % 6 === 0
    const forme = noeud ? 'M0-1.7L1.3 0L0 1.7L-1.3 0Z' : RUNES[i % RUNES.length]
    return `<path${noeud ? ' class="gn"' : ''} d="${forme}" transform="rotate(${r2((360 / n) * i)} ${c} ${c}) translate(${c} ${r2(c - bande)})"/>`
  }).join('')
  const pointe = (k: number, r: number): Pt => {
    const a = (Math.PI / 3) * k - Math.PI / 2
    return [r2(c + r * Math.cos(a)), r2(c + r * Math.sin(a))]
  }
  const rE = 37.5
  const triangle = (k0: number): string =>
    `M${[k0, k0 + 2, k0 + 4].map((k) => pointe(k, rE).join(' ')).join('L')}Z`
  const points = [0, 1, 2, 3, 4, 5]
    .map((k) => {
      const [x, y] = pointe(k, rE)
      return `<circle class="gn" cx="${x}" cy="${y}" r="1.2"/>`
    })
    .join('')
  return (
    `<circle cx="${c}" cy="${c}" r="29.5" stroke-width=".9"/>` +
    `<g class="gi"><circle cx="${c}" cy="${c}" r="34.5" stroke-width=".8" stroke-dasharray="1.2 2.4"/>` +
    `<path d="${triangle(0)}${triangle(1)}" stroke-width=".8"/>${points}</g>` +
    `<g class="ge"><circle cx="${c}" cy="${c}" r="${R}" stroke-width="1.1"/>` +
    `<circle cx="${c}" cy="${c}" r="${interieur}" stroke-width=".7"/>` +
    `<g class="gp" stroke-width=".6">${couronne}</g></g>`
  )
}

// ---------------- Le visage : des expressions qui changent ----------------
/**
 * LE VISAGE VIVANT (conv-1227, 2026-10-28, « ses expressions de visage doivent changer, pas
 * statiques, pour le rendre vraiment vivant »). Chaque état a SON visage (`fT`, `fA`, `fR`, `fP`),
 * qui joue en boucle :
 * - au travail : les yeux suivent la baguette qui écrit (même durée que le tracé, donc en phase),
 *   sourcils froncés et yeux plissés de concentration, puis ils montent avec le chiffre vers le
 *   chapeau, « oh ! », et un grand sourire quand il s'embrase ; la bouche change à chaque chiffre
 *   (langue tirée, coin de bouche, petit « o ») ;
 * - pour toi : rire, yeux en « ^ ^ », clin d'œil, étoiles dans les yeux, « waouh » ;
 * - au calme : il dort, respire, bâille, et entrouvre un œil pour jeter un coup d'œil ;
 * - problème : sourcils inquiets, regard fuyant, bouche qui tremble, goutte de sueur.
 * Les bouches se transforment l'une en l'autre (propriété CSS `d`) : toutes ont le même tracé
 * (deux courbes de Bézier), seule leur géométrie change.
 */
type Bouche = readonly [Pt, Pt, number, number, number]
/** Coin gauche, coin droit, hauteur des contrôles de la lèvre du haut et du bas, retrait des contrôles. */
function dBouche([g, d, haut, bas, k]: Bouche): string {
  const dx = (d[0] - g[0]) * k
  return `M${g[0]} ${g[1]}C${r2(g[0] + dx)} ${haut} ${r2(d[0] - dx)} ${haut} ${d[0]} ${d[1]}C${r2(d[0] - dx)} ${bas} ${r2(g[0] + dx)} ${bas} ${g[0]} ${g[1]}Z`
}
const BOUCHES = {
  o: [[24, 31.6], [28, 31.6], 28.4, 34.8, 0],
  waouh: [[23.4, 32], [28.6, 32], 27.6, 36.4, 0],
  sourire: [[21.8, 30.4], [30.2, 30.4], 31.2, 33.3, 0.2],
  rire: [[19.5, 29.5], [32.5, 29.5], 30.2, 35.5, 0.2],
  moue: [[24.5, 32.2], [30, 31.2], 31.4, 33.6, 0.2],
  coin: [[22, 31.8], [30.4, 30.2], 31.8, 33.6, 0.2],
  souci: [[21.5, 33], [30.5, 33], 30.8, 32, 0.2],
  dort: [[24.6, 31.8], [27.4, 31.8], 30.3, 33.3, 0],
  baille: [[22.8, 31.5], [29.2, 31.5], 27.5, 38, 0]
} as const satisfies Record<string, Bouche>

const NUIT = '#120e24'
const traitNuit = (w: number): string =>
  `stroke="${NUIT}" stroke-width="${w}" stroke-linecap="round" fill="none"`
const oeil = (x: number, reflet: number, eclat_: number): string =>
  `<ellipse cx="${x}" cy="21" rx="4" ry="4.8" fill="url(#gY)"/><ellipse cx="${reflet}" cy="19.1" rx="1.45" ry="1.65" fill="#fff"/><circle cx="${eclat_}" cy="22.7" r=".65" fill="#fff" fill-opacity=".8"/>`
const OEIL_G = oeil(18.98, 17.68, 20.44)
const OEIL_D = oeil(33.02, 31.72, 34.48)
const sourcil = (cote: 'g' | 'd', classe: string): string =>
  `<path class="${classe}" d="${cote === 'g' ? 'M15.4 15.6q2.8-1.4 5.6-.3' : 'M31 15.3q2.8-1.1 5.6.3'}" ${traitNuit(1.1)}/>`
const ARC_HEUREUX_G = 'M15 22.6q4-4.6 8 0'
const ARC_HEUREUX_D = 'M29 22.6q4-4.6 8 0'

function visage(f: Feuille): string {
  const d = (b: Bouche): string => `d:path("${dBouche(b)}")`
  const bouche = (classe: string, b: Bouche): string =>
    `<path class="${classe}" d="${dBouche(b)}" fill="url(#gM)"/>`
  const lineaire = { courbe: 'linear' }
  // Un clignement, puis un double, à intervalles inégaux : 5,6 s, sans rapport avec les autres cycles.
  const cligne = f.anim(
    [
      [0, 'scale:1 1'],
      [40, 'scale:1 1'],
      [42, 'scale:1 .08'],
      [44.5, 'scale:1 1'],
      [86, 'scale:1 1'],
      [88, 'scale:1 .08'],
      [90, 'scale:1 1'],
      [92, 'scale:1 .08'],
      [94.5, 'scale:1 1'],
      [100, 'scale:1 1']
    ],
    5.6,
    lineaire
  )
  // Sourcils : `s` = 1 à gauche, -1 à droite (une rotation positive baisse le bout intérieur gauche).
  const paire = (images: (s: number) => Image[], duree: number): [string, string] => [
    f.anim(images(1), duree),
    f.anim(images(-1), duree)
  ]
  const sourcils = ([g, dr]: [string, string]): string => sourcil('g', g) + sourcil('d', dr)

  // ---- Au travail : en phase avec le tracé (D_TRACE), le visage suit la baguette puis le chiffre.
  const T = D_TRACE
  const regardT = f.anim(
    [
      [0, 'translate:1px -.4px'],
      [4, 'translate:1.7px -.8px'],
      [34, 'translate:1.9px 0px'],
      [60, 'translate:1.7px .7px'],
      [66, 'translate:.4px -1.2px'],
      [78, 'translate:0px -1.6px'],
      [88, 'translate:0px -.3px'],
      [100, 'translate:1px -.4px']
    ],
    T
  )
  const plisseT = f.anim(
    [
      [0, 'scale:1 1'],
      [10, 'scale:1 .82'],
      [58, 'scale:1 .82'],
      [66, 'scale:1 1.06'],
      [76, 'scale:1 1'],
      [81, 'scale:1.05 .5'],
      [90, 'scale:1 1'],
      [100, 'scale:1 1']
    ],
    T
  )
  const sourcilsT = paire(
    (s) => [
      [0, `translate:0 .3px;rotate:${4 * s}deg`],
      [10, `translate:0 .6px;rotate:${12 * s}deg`],
      [58, `translate:0 .6px;rotate:${12 * s}deg`],
      [66, `translate:0 -1.3px;rotate:${-5 * s}deg`],
      [80, `translate:0 -1.4px;rotate:${-6 * s}deg`],
      [92, `translate:0 0px;rotate:${2 * s}deg`],
      [100, `translate:0 .3px;rotate:${4 * s}deg`]
    ],
    T
  )
  // Trois chiffres d'affilée, trois bouches d'écriture : langue tirée, coin de bouche, petit « o ».
  const P = (k: number, t: number): number => (k * 100 + t) / 3
  const imagesBoucheT: Image[] = [[0, d(BOUCHES.rire)]]
  ;[BOUCHES.moue, BOUCHES.coin, BOUCHES.o].forEach((b, k) =>
    imagesBoucheT.push(
      [P(k, 5), d(b)],
      [P(k, 62), d(b)],
      [P(k, 68), d(BOUCHES.waouh)],
      [P(k, 79), d(BOUCHES.waouh)],
      [P(k, 84), d(BOUCHES.rire)],
      [P(k, 95), d(BOUCHES.rire)]
    )
  )
  imagesBoucheT.push([100, d(BOUCHES.rire)])
  const boucheT = f.anim(imagesBoucheT, 3 * T)
  const langueT = f.anim(
    [
      [0, 'opacity:0'],
      [P(0, 7), 'opacity:1'],
      [P(0, 60), 'opacity:1'],
      [P(0, 63), 'opacity:0'],
      [100, 'opacity:0']
    ],
    3 * T,
    lineaire
  )
  // LES YEUX S'ALLUMENT (conv-1227, 2026-10-28, « une expression où ses yeux s'éclairent et de
  // l'énergie s'en échappe ») : au sommet du sort, quand la sphère éclate et que le chiffre file au
  // chapeau, ses yeux deviennent lumière et l'énergie en jaillit vers l'extérieur, en filets.
  const allume = f.anim(
    [
      [0, 'opacity:0'],
      [61, 'opacity:0'],
      [65, 'opacity:1'],
      [80, 'opacity:1'],
      [87, 'opacity:0'],
      [100, 'opacity:0']
    ],
    T,
    lineaire
  )
  const coule = f.anim(
    [
      [0, 'stroke-dashoffset:12'],
      [100, 'stroke-dashoffset:0']
    ],
    0.45,
    lineaire
  )
  // YEUX DE COULEUR (conv-1227, 2026-10-28, « ses yeux peuvent aussi devenir rouges », puis « jaunes
  // ou verts ») : d'un sort à l'autre, les yeux s'allument en cyan, rouge, jaune, puis vert (`teinte`,
  // la même relève que l'encre du chiffre écrit, conv-1247).
  const yeuxDeLumiere = (coeur: string): string =>
    [18.98, 33.02]
      .map((x) => `<ellipse cx="${x}" cy="21" rx="4.4" ry="5.2" fill="url(#${coeur})"/>`)
      .join('')
  // `s` = 1 pour l'œil gauche (l'énergie part à gauche), -1 pour le droit.
  const energieDesYeux = (halo: string, filet: string): string =>
    (
      [
        [18.98, 1],
        [33.02, -1]
      ] as const
    )
      .map(
        ([x, s]) =>
          `<circle cx="${x}" cy="21" r="8.5" fill="url(#${halo})"/>` +
          `<path class="${coule}" d="M${r2(x - s * 3.6)} 19.4q${-s * 4}-1.4 ${r2(-s * 7.4)}-5.6M${r2(x - s * 3.8)} 22.6q${-s * 5} .4 ${r2(-s * 9.4)}-1.6M${r2(x - s * 2)} 16.8q${r2(-s * 1.6)}-3 ${r2(-s * 4.6)}-5.2" stroke="${filet}" stroke-width="1.4" stroke-dasharray="5 7" fill="none"/>`
      )
      .join('')
  // [cœur de l'œil, halo, filets d'énergie] de chaque couleur, dans leur ordre d'apparition — celui
  // de `COULEURS_DU_SORT`, l'encre du chiffre écrit.
  const COULEURS_DES_YEUX = [
    ['gE', 'gEh', '#e8fdff'],
    ['gEr', 'gEhr', '#ffe1dc'],
    ['gEj', 'gEhj', '#fff6c8'],
    ['gEv', 'gEhv', '#e2ffe0']
  ] as const
  const teintes = COULEURS_DES_YEUX.map((_, k) => teinte(f, k, COULEURS_DES_YEUX.length))
  const travail =
    `<g class="fT">${sourcils(sourcilsT)}` +
    `<g class="${regardT}"><g class="${plisseT}"><g class="${cligne}">${OEIL_G}${OEIL_D}<g class="${allume}">` +
    COULEURS_DES_YEUX.map(
      ([coeur], k) => `<g class="${teintes[k]}">${yeuxDeLumiere(coeur)}</g>`
    ).join('') +
    '</g></g></g></g>' +
    `<g class="${allume}">` +
    COULEURS_DES_YEUX.map(
      ([, halo, filet], k) => `<g class="${teintes[k]}">${energieDesYeux(halo, filet)}</g>`
    ).join('') +
    '</g>' +
    bouche(boucheT, BOUCHES.rire) +
    `<path class="${langueT}" d="M28.6 32.1q2.4-.7 2.9 1.4q.3 1.6-1.3 1.6q-1.4 0-1.6-3z" fill="url(#gT)"/></g>`

  // ---- Pour toi : rire, yeux « ^ ^ », clin d'œil, étoiles dans les yeux, « waouh ».
  const A = 4.2
  const bascule = (on: boolean): string =>
    f.anim(
      [
        [0, `opacity:${on ? 1 : 0}`],
        [30, `opacity:${on ? 1 : 0}`],
        [32, `opacity:${on ? 0 : 1}`],
        [55, `opacity:${on ? 0 : 1}`],
        [57, `opacity:${on ? 1 : 0}`],
        [100, `opacity:${on ? 1 : 0}`]
      ],
      A,
      lineaire
    )
  const clin = f.anim(
    [
      [0, 'scale:1 1'],
      [72, 'scale:1 1'],
      [74, 'scale:1 .08'],
      [84, 'scale:1 .08'],
      [86, 'scale:1 1'],
      [100, 'scale:1 1']
    ],
    A,
    lineaire
  )
  const arcDuClin = f.anim(
    [
      [0, 'opacity:0'],
      [73, 'opacity:0'],
      [74, 'opacity:1'],
      [84, 'opacity:1'],
      [85, 'opacity:0'],
      [100, 'opacity:0']
    ],
    A,
    lineaire
  )
  const scintille = (delai: number): string =>
    f.anim(
      [
        [0, 'scale:.4;opacity:.6'],
        [50, 'scale:1.15;opacity:1'],
        [100, 'scale:.4;opacity:.6']
      ],
      1.1,
      { delai }
    )
  const sourcilsA = paire(
    (s) => [
      [0, `translate:0 -1px;rotate:${-6 * s}deg`],
      [50, `translate:0 -1.8px;rotate:${-9 * s}deg`],
      [100, `translate:0 -1px;rotate:${-6 * s}deg`]
    ],
    A / 2
  )
  const boucheA = f.anim(
    [
      [0, d(BOUCHES.rire)],
      [14, d(BOUCHES.rire)],
      [18, d(BOUCHES.sourire)],
      [22, d(BOUCHES.rire)],
      [38, d(BOUCHES.rire)],
      [43, d(BOUCHES.waouh)],
      [52, d(BOUCHES.waouh)],
      [57, d(BOUCHES.rire)],
      [62, d(BOUCHES.sourire)],
      [66, d(BOUCHES.rire)],
      [70, d(BOUCHES.sourire)],
      [74, d(BOUCHES.rire)],
      [100, d(BOUCHES.rire)]
    ],
    A
  )
  // La langue seulement dans le grand rire : elle déborderait d'un sourire ou d'un « waouh ».
  const langueA = f.anim(
    [
      [0, 'opacity:1'],
      [14, 'opacity:1'],
      [16, 'opacity:0'],
      [24, 'opacity:0'],
      [26, 'opacity:1'],
      [38, 'opacity:1'],
      [40, 'opacity:0'],
      [78, 'opacity:0'],
      [80, 'opacity:1'],
      [100, 'opacity:1']
    ],
    A,
    lineaire
  )
  const etincelle = (x: number, classe: string): string =>
    `<path class="${classe}" d="${eclat(x, 18.8, 1.5)}" fill="#fff"/>`
  const attente =
    `<g class="fA">${sourcils(sourcilsA)}` +
    `<g class="${bascule(true)}"><g class="${cligne}">${OEIL_G}${etincelle(17.6, scintille(0))}` +
    `<g class="${clin}">${OEIL_D}${etincelle(31.6, scintille(0.5))}</g></g></g>` +
    `<path class="${bascule(false)}" d="${ARC_HEUREUX_G}${ARC_HEUREUX_D}" ${traitNuit(1.6)}/>` +
    `<path class="${arcDuClin}" d="${ARC_HEUREUX_D}" ${traitNuit(1.6)}/>` +
    bouche(boucheA, BOUCHES.rire) +
    `<path class="${langueA}" d="M22.5 33q3.5 2.4 7 0q-3.5-1.6-7 0z" fill="url(#gT)"/></g>`

  // ---- Au calme : il dort, respire, bâille, et entrouvre un œil.
  const R = 10
  const plisseR = f.anim(
    [
      [0, 'scale:1 1'],
      [30, 'scale:1 1'],
      [34, 'scale:1.1 .55'],
      [42, 'scale:1.1 .55'],
      [46, 'scale:1 1'],
      [100, 'scale:1 1']
    ],
    R
  )
  const fermeD = f.anim(
    [
      [0, 'opacity:1'],
      [63, 'opacity:1'],
      [64, 'opacity:0'],
      [78, 'opacity:0'],
      [79, 'opacity:1'],
      [100, 'opacity:1']
    ],
    R,
    lineaire
  )
  const ouvertD = f.anim(
    [
      [0, 'opacity:0;scale:1 .1'],
      [63.5, 'opacity:0;scale:1 .1'],
      [64, 'opacity:1;scale:1 .1'],
      [66, 'opacity:1;scale:1 1'],
      [76, 'opacity:1;scale:1 1'],
      [78.5, 'opacity:1;scale:1 .1'],
      [79, 'opacity:0;scale:1 .1'],
      [100, 'opacity:0;scale:1 .1']
    ],
    R,
    lineaire
  )
  const coupDOeil = f.anim(
    [
      [0, 'translate:0 0'],
      [66, 'translate:0 0'],
      [68.5, 'translate:-1.5px .3px'],
      [71.5, 'translate:-1.5px .3px'],
      [73.5, 'translate:1.3px .2px'],
      [75, 'translate:1.3px .2px'],
      [76.5, 'translate:0 0'],
      [100, 'translate:0 0']
    ],
    R
  )
  const boucheR = f.anim(
    [
      [0, d(BOUCHES.dort)],
      [30, d(BOUCHES.dort)],
      [35, d(BOUCHES.baille)],
      [41, d(BOUCHES.baille)],
      [46, d(BOUCHES.dort)],
      [100, d(BOUCHES.dort)]
    ],
    R
  )
  const souffle = f.anim(
    [
      [0, 'scale:.85'],
      [50, 'scale:1.15'],
      [100, 'scale:.85']
    ],
    3.4
  )
  const sourcilsR = f.anim(
    [
      [0, 'translate:0 .4px'],
      [33, 'translate:0 .4px'],
      [37, 'translate:0 -1.2px'],
      [42, 'translate:0 -1.2px'],
      [46, 'translate:0 .4px'],
      [64, 'translate:0 .4px'],
      [66, 'translate:0 -.6px'],
      [77, 'translate:0 -.6px'],
      [79, 'translate:0 .4px'],
      [100, 'translate:0 .4px']
    ],
    R
  )
  const calme =
    `<g class="fR">${sourcils([sourcilsR, sourcilsR])}` +
    `<g class="${plisseR}"><path d="M15 21.5q4 3 8 0" ${traitNuit(1.5)}/><path class="${fermeD}" d="M29 21.5q4 3 8 0" ${traitNuit(1.5)}/></g>` +
    `<g class="${ouvertD}"><g class="${coupDOeil}">${OEIL_D}</g></g>` +
    `<g class="${souffle}">${bouche(boucheR, BOUCHES.dort)}</g></g>`

  // ---- Problème : sourcils inquiets, regard fuyant, bouche qui tremble, goutte de sueur.
  const Pb = 4.8
  const sourcilsP = paire(
    (s) => [
      [0, `translate:0 -.4px;rotate:${-14 * s}deg`],
      [50, `translate:0 -1px;rotate:${-19 * s}deg`],
      [100, `translate:0 -.4px;rotate:${-14 * s}deg`]
    ],
    Pb / 2
  )
  const regardP = f.anim(
    [
      [0, 'translate:-1.3px 1px'],
      [34, 'translate:-1.3px 1px'],
      [42, 'translate:0 0'],
      [78, 'translate:0 0'],
      [86, 'translate:1.2px .8px'],
      [94, 'translate:-1.3px 1px'],
      [100, 'translate:-1.3px 1px']
    ],
    Pb
  )
  const boucheP = f.anim(
    [
      [0, d(BOUCHES.souci)],
      [38, d(BOUCHES.souci)],
      [44, d(BOUCHES.o)],
      [60, d(BOUCHES.o)],
      [66, d(BOUCHES.souci)],
      [100, d(BOUCHES.souci)]
    ],
    Pb
  )
  const tremble = f.anim(
    [
      [0, 'translate:-.25px 0'],
      [50, 'translate:.25px 0'],
      [100, 'translate:-.25px 0']
    ],
    0.18,
    lineaire
  )
  const goutte = f.anim(
    [
      [0, 'translate:0 -1px;opacity:0'],
      [12, 'translate:0 0;opacity:1'],
      [70, 'translate:0 7px;opacity:1'],
      [85, 'translate:0 9px;opacity:0'],
      [100, 'translate:0 9px;opacity:0']
    ],
    2.4
  )
  const probleme =
    `<g class="fP">${sourcils(sourcilsP)}` +
    `<g class="${regardP}"><g class="${cligne}">${OEIL_G}${OEIL_D}</g></g>` +
    `<g class="${tremble}">${bouche(boucheP, BOUCHES.souci)}</g>` +
    `<path class="${goutte}" d="M44.5 10.5q-1.8 2.8-1.8 4a1.8 1.8 0 0 0 3.6 0q0-1.2-1.8-4z" fill="#9fdcff" stroke="#3d8bff" stroke-width=".4"/></g>`

  return travail + attente + calme + probleme
}

// ---------------- La page : le dessin et sa feuille, construits une fois ----------------
const ombre = (a: string, b: string, c: string, x: number, y: number, z: number): string =>
  `drop-shadow(0 0 ${x}px ${a}) drop-shadow(0 0 ${y}px ${b}) drop-shadow(0 0 ${z}px ${c})`

type Personnage = {
  svg: string
  css: string
  visage: string
  ecarts: Record<string, number>
  /** Les animations jouées une fois, que la feuille du travail déclenche (l'ouverture du grimoire). */
  ouverture: Array<[string, string]>
}
let construit: Personnage | null = null

function construire(): Personnage {
  // Les motifs d'abord : `peint` lit leur boîte, qu'il faut avoir définie avant de les poser.
  const definitions = defs()
  const f = creerFeuille()
  const fv = creerFeuille('.y', 'xv')
  const expressions = visage(fv)
  const ecarts: Record<string, number> = {}
  const travail = auTravail(f)
  ecarts['gauche au travail'] = travail.ecart
  const fete = pourToi(f)
  ecarts['bras pour toi'] = fete.ecart
  const chapeau =
    `<ellipse cx="26" cy="13.5" rx="21" ry="4.5" fill="url(#gSh)"/><path d="${PLIEE}" fill="url(#gH)"/>` +
    '<path d="M10 4C13-6 17-15 21-22" stroke="#fff" stroke-opacity=".35" stroke-width="1.5" fill="none"/><path d="M32-24Q30-19 33-10" stroke="#1d1460" stroke-opacity=".55" stroke-width="1.1" fill="none"/>' +
    '<ellipse cx="26" cy="9" rx="25" ry="4.2" fill="url(#gB)"/>'
  // L'étoile JAUNE (conv-1227, « l'étoile du chapeau fais-la jaune ») : pleine, sans lueur — c'est
  // toujours le chiffre blanc posé dessus qui brille.
  const etoileDuChapeau = `<path d="${etoile(25, -3, 10.5)}" fill="#ffd23f" stroke="#fff0a8" stroke-width=".9"/>`
  // L'ÉTOILE PREND LA COULEUR DU CHIFFRE QUI L'ATTEINT (conv-1247, « au moment où un chiffre rouge
  // atteint l'étoile, ça met l'étoile rouge ») : au travail, quand le chiffre écrit se pose sur elle
  // (`T_ARRIVEE` de chaque sort), elle prend sa couleur et la garde jusqu'au chiffre suivant. Hors
  // travail, le groupe `ET` est éteint : elle reste jaune.
  const sorts = COULEURS_DU_SORT.length
  const arrivee = (k: number): number => ((100 * k + T_ARRIVEE) / sorts) % 100
  const etoilesDuSort =
    '<g class="ET">' +
    COULEURS_DU_SORT.map(
      ({ vif, bord }, k) =>
        `<g class="${allumeDe(f, arrivee(k), arrivee(k + 1), sorts * D_TRACE)}"><path d="${etoile(25, -3, 10.5)}" fill="${vif}" stroke="${bord}" stroke-width=".9"/></g>`
    ).join('') +
    '</g>'
  // Le chiffre en DEUX couches, l'étoile entre les deux : la lueur du chiffre (filtre de 6 px)
  // couvrait l'étoile et la rendait gris-bleu (#b0cbce au lieu de #ffd23f, sondé le 2026-10-28). Sa
  // copie lumineuse passe donc DERRIÈRE l'étoile, et le chiffre net, sans lueur, devant.
  const chiffres =
    textesDuCompte((s) => `ch nb v${s}`, '#ffffff') +
    texteChiffre('!', 'ch nr vx', '#fff1f0') +
    etoileDuChapeau +
    etoilesDuSort +
    textesDuCompte((s) => `ch v${s}`, '#ffffff') +
    texteChiffre('!', 'ch vx', '#fff1f0')
  // Au travail, un groupe par chiffre seul : la baguette écrit CE chiffre, qui file au chapeau et s'y
  // embrase.
  const eclair = eclairDuChapeau(f)
  const seuls = SEULS.map((v) => {
    const t = tracer(f, v)
    ecarts[`trace ${v}`] = t.ecart
    return (
      `<g class="t${v}">${t.dessin}${bras(S_R, U_R, F_R, t.joints, baguette('oB'))}` +
      `<g class="${eclair}">${texteChiffre(v, 'fx', '#fff')}</g></g>`
    )
  }).join('')
  // Deux chiffres (conv-1270) : un groupe par chiffre et par place (`tracerALaPlace`). Les traits des
  // deux chiffres volent ENSEMBLE au chapeau, dans un seul groupe : il rapetisse autour du centre de
  // ce qui y est allumé, la paire écrite, et pas chaque chiffre autour du sien. Même chose pour
  // l'embrasement des deux chiffres du chapeau.
  const places = (['d', 'u'] as const).flatMap((place) =>
    CHIFFRES_DE[place].map((c) => {
      const t = tracerALaPlace(f, c, place)
      ecarts[`trace ${place}${c}`] = t.ecart
      return { classe: `t${place}${c}`, place, t }
    })
  )
  ecarts['relais'] = ecartDuRelais(
    places.filter(({ place }) => place === 'd').map(({ t }) => t),
    places.filter(({ place }) => place === 'u').map(({ t }) => t)
  )
  const deuxChiffres =
    `<g class="${volVersLeChapeau(f, G2)}">` +
    places.map(({ classe, t }) => `<g class="${classe}">${t.encres}</g>`).join('') +
    '</g>' +
    places
      .map(
        ({ classe, t }) =>
          `<g class="${classe}"><g class="${t.visible}">${bras(S_R, U_R, F_R, t.joints, baguette('oB'))}</g></g>`
      )
      .join('') +
    `<g class="${eclair}">${textesALaPlace((s) => `fx t${s}`, '#fff')}</g>`
  const ecritures = seuls + deuxChiffres
  // Pour toi : le chiffre s'embrase et flotte, écrit en or, à droite.
  const enOrDe = (traits: Pt[][], classe: string): string =>
    `<path class="${classe}${lueurDe(OR)} pu" d="${traits.map(dChemin).join('')}" stroke="#fff3c4" stroke-width="1.6" fill="none"/>`
  const enOr =
    SEULS.map(
      (v) =>
        `<g class="v${v}"><g class="${fete.eclair}">${texteChiffre(v, 'fx', '#fff')}</g>` +
        `${enOrDe(traitsDuChiffre(v), '')}</g>`
    ).join('') +
    `<g class="${fete.eclair}">${textesALaPlace((s) => `fx v${s}`, '#fff')}</g>` +
    (['d', 'u'] as const)
      .flatMap((place) =>
        CHIFFRES_DE[place].map((c) => enOrDe(traitsALaPlace(c, place), `v${place}${c} `))
      )
      .join('')
  const corps =
    '<ellipse cx="26" cy="66" rx="16" ry="2.4" fill="url(#gSh)"/>' +
    // `LG` : le grimoire seul, sans le reste du travail, pour la mascotte qui lit (`reglesDeLAccueil`).
    `<g class="ET LG">${travail.grimoire}</g>` +
    // Au calme, le grimoire est fermé (conv-1227) ; il s'ouvre quand le travail commence.
    `<g class="GF">${grimoireFerme(f)}</g>` +
    chapeau +
    chiffres +
    `<g class="ET">${travail.invocation}${travail.follets}${travail.gauche}</g>` +
    ecritures +
    `<g class="ET">${travail.marges}</g>` +
    `<g class="EA">${enOr}${fete.fete}${fete.bras}</g>` +
    `<g class="ER">${bras(S_L, U_L, F_L, REPOS)}</g>` +
    `<g class="ER rD">${bras(S_R, U_R, F_R, REPOS, baguette('oB'))}</g>`
  const svg =
    `<svg class="p" viewBox="0 0 ${LARGEUR_MASCOTTE} ${HAUTEUR_MASCOTTE}" aria-hidden="true">${definitions}` +
    `<g transform="translate(${ORIGINE.x} ${ORIGINE.y})">${corps}</g></svg>`
  const masques = [
    'ET',
    'EA',
    'ER',
    'rD',
    'GF',
    ...SUFFIXES.map((s) => `t${s}`),
    ...SUFFIXES.map((s) => `v${s}`),
    'vx',
    // Le visage (`visageDeLaBille`) : un visage par état, rallumé par son état.
    'fT',
    'fA',
    'fR',
    'fP'
  ]
  const css = [
    `.p{position:absolute;left:0;top:0;width:${LARGEUR_MASCOTTE}px;height:${HAUTEUR_MASCOTTE}px;overflow:visible;pointer-events:none;stroke-linecap:round;stroke-linejoin:round}`,
    '.p *{transform-box:fill-box;transform-origin:center}',
    '.p .jt{transform-box:view-box;transform-origin:0 0}',
    // Une seule classe par règle : la feuille de l'état (`body .x`) doit pouvoir les rallumer.
    ...masques.map((c) => `.${c}{display:none}`),
    ...LUEURS.map(
      (c) => `.p .${lueurDe(c)}{filter:drop-shadow(0 0 1.4px ${c}) drop-shadow(0 0 .5px ${c})}`
    ),
    '.p .fl8{animation:fl8 .18s steps(2) infinite}',
    '@keyframes fl8{50%{transform:scaleY(.75)}}',
    '.p .pu{animation:ob 1.4s infinite}',
    // Le chiffre : cerné de nuit pour se détacher du verre de l'étoile, et c'est LUI qui brille.
    '.p .ch{paint-order:stroke;stroke:#1d1460;stroke-width:1.8px;stroke-linejoin:round}',
    `@keyframes nb{0%,46%,49%,53%,100%{filter:${ombre('#fff', '#9fd8ff', '#3d8bff', 1, 2.8, 6)}}47.5%,51%{filter:${ombre('#fff', '#9fd8ff', '#3d8bff', 0.4, 1, 1.6)}}}`,
    '.p .nb{animation:nb 3s linear infinite}',
    `.p .nr{filter:${ombre('#ffd0cc', '#ff6b5e', '#e5534b', 1, 2.8, 6)}}`,
    `.p .fx{filter:${ombre('#fff', '#fff', '#ffe9a0', 1.5, 4, 9)}}`,
    ...f.regles,
    // Le visage : chaque partie tourne, plisse ou cligne autour de son propre centre.
    '.y *{transform-box:fill-box;transform-origin:center}',
    ...fv.regles
  ].join('\n')
  return { svg, css, visage: expressions, ecarts, ouverture: f.declenchees }
}

function personnage(): Personnage {
  construit ??= construire()
  return construit
}

/** Le dessin du personnage, à poser par-dessus la bille. */
export const svgDuPersonnage = (): string => personnage().svg
/** Sa feuille fixe : positions, allures, et toutes les images clés. */
export const cssDuPersonnage = (): string => personnage().css
/** Pour les tests : à quelle distance de sa cible chaque main (ou la pointe) passe-t-elle, au pire. */
export const ecartsDesBras = (): Readonly<Record<string, number>> => personnage().ecarts

/**
 * LE VISAGE, peint sur la bille (sous le chapeau et les bras) : les joues, et un visage animé par
 * état (`visage`), que l'état rallume (`reglesDuPersonnage`).
 */
export function visageDeLaBille(): string {
  return (
    '<svg class="y" viewBox="0 0 52 52" aria-hidden="true"><defs>' +
    rad('gY', st(0, '#3d3566') + st(0.78, '#120e24') + st(0.92, '#120e24') + st(1, '#120e24', 0)) +
    rad('gJ', st(0, '#ff7fb8', 0.6) + st(0.8, '#ff7fb8', 0.6) + st(1, '#ff7fb8', 0)) +
    rad('gM', st(0, '#6a2546') + st(1, '#1a0a14'), 0.5, 0.2, 0.8) +
    lin('gT', st(0, '#ffa3bb') + st(1, '#e0466e'), 0, 1) +
    // Les yeux de lumière : cœur blanc, iris cyan, et leur halo.
    rad('gE', st(0, '#ffffff') + st(0.35, '#d2f8ff') + st(0.78, '#58c8ff') + st(1, '#58c8ff', 0)) +
    rad('gEh', st(0, '#8fe9ff', 0.75) + st(0.5, '#8fe9ff', 0.3) + st(1, '#8fe9ff', 0)) +
    // Et leur version rouge, un sort sur deux.
    rad('gEr', st(0, '#ffffff') + st(0.3, '#ffd6cf') + st(0.75, '#ff3b2f') + st(1, '#ff3b2f', 0)) +
    rad('gEhr', st(0, '#ff6a5c', 0.75) + st(0.5, '#ff6a5c', 0.3) + st(1, '#ff6a5c', 0)) +
    // Puis jaune, puis vert (conv-1227, « les yeux peuvent aussi devenir jaunes ou verts »).
    rad('gEj', st(0, '#ffffff') + st(0.3, '#fff6c2') + st(0.75, '#ffd21f') + st(1, '#ffd21f', 0)) +
    rad('gEhj', st(0, '#ffe066', 0.75) + st(0.5, '#ffe066', 0.3) + st(1, '#ffe066', 0)) +
    rad('gEv', st(0, '#ffffff') + st(0.3, '#d6ffd2') + st(0.75, '#3ee05a') + st(1, '#3ee05a', 0)) +
    rad('gEhv', st(0, '#6dff86', 0.75) + st(0.5, '#6dff86', 0.3) + st(1, '#6dff86', 0)) +
    '</defs>' +
    '<ellipse cx="11.44" cy="31.98" rx="3.43" ry="2.13" fill="url(#gJ)"/><ellipse cx="40.56" cy="31.98" rx="3.43" ry="2.13" fill="url(#gJ)"/>' +
    personnage().visage +
    '</svg>'
  )
}

/**
 * L'ACCUEIL D'UN FIL VIDE (conv-1401, « prend exactement la meme mascotte qu'on a dans les settings ») :
 * deux humeurs que le bureau n'a pas, faites de ses pièces, sans aucun dessin neuf. Éveillée : le
 * visage heureux de « pour toi », bras au repos, grimoire fermé, car son repos à elle a les yeux
 * fermés. Lectrice : le visage concentré du travail et son grimoire ouvert, sans sort ni halo.
 */
export function reglesDeLAccueil(humeur: 'eveil' | 'lecture'): Array<[string, string]> {
  const repos: [string, string] = ['.ER', 'display:inline']
  if (humeur === 'eveil') return [repos, ['.fA', 'display:inline'], ['.GF', 'display:inline']]
  return [repos, ['.fT', 'display:inline'], ['.LG', 'display:inline'], ...personnage().ouverture]
}

/**
 * Ce que chaque état ALLUME du personnage, en [sélecteurs, déclarations] (`cssDeLEtat` les préfixe).
 * Tout est éteint par la page ; un état n'affiche que ses groupes, et le chiffre de sa pastille.
 */
export function reglesDuPersonnage(
  etat: 'calme' | 'travail' | 'attente' | 'probleme',
  pastille: string | null
): Array<[string, string]> {
  const regles: Array<[string, string]> = []
  for (const valeur of classesDeLaValeur(pastille)) regles.push([`.${valeur}`, 'display:inline'])
  switch (etat) {
    case 'travail': {
      const traces = classesDuTrace(pastille)
      // Sans compte lisible, le bras droit reste au repos plutôt que de disparaître.
      regles.push(
        ['.ET', 'display:inline'],
        ...(traces.length ? traces : ['rD']).map((c): [string, string] => [
          `.${c}`,
          'display:inline'
        ]),
        ['.fT', 'display:inline'],
        // L'ouverture du grimoire part ICI, quand le travail commence (voir `Options.une`).
        ...personnage().ouverture
      )
      break
    }
    case 'attente':
      regles.push(['.EA', 'display:inline'], ['.fA', 'display:inline'])
      break
    case 'calme':
      regles.push(['.ER', 'display:inline'], ['.fR', 'display:inline'], ['.GF', 'display:inline'])
      break
    case 'probleme':
      regles.push(['.ER', 'display:inline'], ['.fP', 'display:inline'])
      break
  }
  return regles
}
