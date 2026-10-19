/*
 * LA MARCHE DES PASSANTS : CHACUN VOIT LES AUTRES (conv-331, /draft « Croisement anticipé »).
 *
 * Avant, la place d'un passant ne dépendait que de l'heure (`positionZ`) : chacun suivait sa file
 * sans voir personne, et les corps se traversaient. Mesuré sur le vrai décor (banc du 2026-10-18,
 * passage de 112 à 124 s, trottoir de gauche) : 13 images sur 360 avec deux bassins à moins de
 * 50 cm, 27 cm au plus près. Avec cette marche : 0 image.
 *
 * Ce que fait chacun, à chaque pas :
 *   - il VOIT venir les autres jusqu'à `horizon` secondes : s'il va croiser quelqu'un de trop près,
 *     il commence tôt une courbe douce ; de face, chacun prend sa droite ;
 *   - derrière quelqu'un de plus lent, il double par la gauche s'il a la place, sinon il suit à 1 m ;
 *     côte à côte avec un inconnu, celui de derrière laisse filer : on ne marche pas épaule contre épaule ;
 *   - au croisement, son BUSTE pivote (l'épaule s'efface) et il jette parfois un COUP D'ŒIL à
 *     celui qui arrive ;
 *   - quoi qu'il arrive, deux corps ne s'interpénètrent jamais (séparation dure, `ecartMin`).
 *
 * Repère « rue » : x en travers de l'avenue, s le long d'elle ; z monde = enrouler(s + defile).
 * Un passant de sens 1 s'éloigne de la caméra (s décroît), de sens -1 vient vers elle.
 * Aucune dépendance à three.js : la marche se teste seule (home-decor-foule-marche.test.ts).
 */

export const MARCHE = {
  /** Demi-largeur d'épaules, en mètres. */
  rayon: 0.27,
  /** L'écart voulu en plus des deux demi-largeurs quand on se croise. */
  marge: 0.26,
  /** Distance minimale entre deux centres de corps : 8 cm d'air entre les épaules. */
  ecartMin: 0.62,
  /** Ce qu'on vise en plus du besoin pour un croisement à l'aise. */
  aisance: 0.3,
  /** Jusqu'où (en secondes) on voit venir un croisement. */
  horizon: 4.5,
  /** Rotation maximale du buste au croisement (rad). */
  buste: 0.42,
  /** Fréquence des coups d'œil (1 = un toutes les 4 à 10 s quand quelqu'un arrive). */
  regard: 0.6,
  /** Les bandes : écart entre deux voisins (m), avance de celui du milieu à trois, allure commune. */
  bande: { ecart: 0.7, avance: 0.25, allure: 0.95 },
  /** Pas de calcul maximal : une image plus longue est découpée. */
  pas: 1 / 30,
  /**
   * Où marchent les centres des corps, en x : le trottoir moins un pas de la bordure, du mur ou de la
   * rambarde (home-decor-avenue.ts : ROUTE = 4, FACADE = 7,5, GARDE = -7,2).
   */
  trottoirs: { gauche: [-6.85, -4.35], droite: [4.4, 7.1] } as Record<'gauche' | 'droite', readonly [number, number]>
} as const

const FENETRE = 70
const DEBUT = -56

const borne = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
const enroulerDiff = (d: number): number => ((((d + FENETRE / 2) % FENETRE) + FENETRE) % FENETRE) - FENETRE / 2
const angleDiff = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a))
const enroulerZ = (z: number): number => ((((z - DEBUT) % FENETRE) + FENETRE) % FENETRE) + DEBUT

/** Hasard reproductible (mulberry32) : la même foule refait les mêmes coups d'œil. */
function graine(n: number): () => number {
  let a = n >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Marcheur {
  readonly i: number
  /** Son sens de marche (en bande, celui du premier de la bande). */
  sens: 1 | -1
  readonly cote: 'gauche' | 'droite'
  /** Les rangs (dans `passants`) de sa bande, lui compris ; `null` s'il marche seul. */
  bande: readonly number[] | null
  /** Position en travers (m). */
  x: number
  /** Position le long de la rue (m, repère de la rue). */
  s: number
  vx: number
  vs: number
  /** Sa vitesse de marche naturelle (m/s), celle de son clip ; en bande, l'allure commune. */
  vPref: number
  /** Sa file : là où il revient quand personne ne le gêne. */
  xPref: number
  /** Son cap (rad, même sens que `rotation.y`) : il suit sa trajectoire. */
  yaw: number
  /** Sa vitesse réelle (m/s) : le pas de l'animation la suit, les pieds ne glissent pas. */
  vitesse: number
  /** Rotation du buste (rad, > 0 : l'autre passe à sa droite). */
  buste: number
  /** Rotation de la tête par rapport au cap (rad). */
  regard: number
}

/** Un corps immobile à contourner (un figurant), en coordonnées monde ; `r` = sa demi-largeur. */
export interface ObstacleMarche {
  x: number
  z: number
  r: number
}

export interface Marche {
  readonly marcheurs: readonly Marcheur[]
  /** Fait marcher la foule de `dt` secondes ; `defile` = défilement de la rue à cet instant. */
  avancer(dt: number, defile: number, obstacles?: readonly ObstacleMarche[]): void
  /** La position z (monde) d'un marcheur. */
  z(m: Marcheur): number
}

interface Etat extends Marcheur {
  /** Sa place dans sa bande : à côté du centre (`dx`), un peu devant (`ds`), son rang `r` sur `n`. */
  place: { dx: number; ds: number; r: number; n: number } | null
  /** La file de la bande (pour le premier de la bande). */
  xBande: number
  /** Pour le premier de la bande : 0 = de front, 1 = serrée en échelon pour laisser passer. */
  serrage: number
  coteBuste: number
  regardQui: Etat | null
  regardFin: number
  prochainRegard: number
}

interface Voisin {
  b: Etat | null
  dx: number
  ds: number
  vx: number
  vs: number
  r: number
}

/**
 * Crée la marche. `passants` : où est chacun au départ (x, z monde), son sens et sa vitesse ;
 * `camera` : sa position au sol (monde), un obstacle que tout le monde voit venir.
 */
export function creerMarche(options: {
  passants: readonly { x: number; z: number; sens: 1 | -1; vitesse: number }[]
  defile: number
  camera: { x: number; z: number }
  /** Les bandes : rangs dans `passants`, le premier donne le sens ; tous sur le même trottoir. */
  bandes?: readonly (readonly number[])[]
  graine?: number
}): Marche {
  const rnd = graine(options.graine ?? 7)
  const camera = options.camera
  let defile = options.defile
  let vRue = 0
  let horloge = 0
  let statiques: { x: number; s: number; r: number }[] = []
  const agents: Etat[] = options.passants.map((p, i) => ({
    i,
    sens: p.sens,
    cote: p.x < 0 ? 'gauche' : 'droite',
    bande: null,
    place: null,
    xBande: p.x,
    serrage: 0,
    x: p.x,
    s: p.z - defile,
    vx: 0,
    vs: -p.sens * p.vitesse,
    vPref: p.vitesse,
    xPref: p.x,
    yaw: p.sens === 1 ? Math.PI : 0,
    vitesse: p.vitesse,
    buste: 0,
    regard: 0,
    coteBuste: 0,
    regardQui: null,
    regardFin: 0,
    prochainRegard: rnd() * 4
  }))

  // ── LES BANDES : côte à côte, à l'allure du plus lent, centrées sur la file du premier ; à trois,
  // celui du milieu un peu devant (en V). Les autres les contournent comme un seul bloc.
  for (const g of options.bandes ?? []) {
    const chef = agents[g[0]]
    if (g.some((k) => !agents[k] || agents[k].cote !== chef.cote))
      throw new Error(`[decor] bande invalide : ${g.join(', ')} (rangs absents ou sur deux trottoirs)`)
    const v = Math.min(...g.map((k) => agents[k].vPref)) * MARCHE.bande.allure
    const n = g.length
    const [x0, x1] = MARCHE.trottoirs[chef.cote]
    const demi = ((n - 1) / 2) * MARCHE.bande.ecart + MARCHE.rayon
    chef.xBande = borne(chef.xPref, x0 + demi, x1 - demi)
    g.forEach((k, r) => {
      const a = agents[k]
      a.bande = g
      a.sens = chef.sens
      a.vPref = v
      a.vs = -a.sens * v
      a.yaw = chef.yaw
      a.place = { dx: (r - (n - 1) / 2) * MARCHE.bande.ecart, ds: n === 3 && r === 1 ? MARCHE.bande.avance : 0, r, n }
      a.xPref = chef.xBande + a.place.dx
      a.x = a.xPref
      a.s = chef.s - chef.sens * a.place.ds
    })
  }

  /**
   * La place d'un membre, selon que sa bande marche de front ou se serre : en échelon, l'écart en
   * travers fond de 60 % et chacun se décale le long de la rue, si bien que deux voisins restent à
   * 0,7 m l'un de l'autre. Un trio passe de 1,9 m à 1,1 m de large.
   */
  function placeDe(b: Etat): { dx: number; ds: number } {
    if (!b.place || !b.bande) return { dx: 0, ds: 0 }
    const S = agents[b.bande[0]].serrage
    const { dx, ds, r, n } = b.place
    return { dx: dx * (1 - 0.6 * S), ds: ds - S * (r - (n - 1) / 2) * 0.62 }
  }

  /** Quelqu'un d'autre approche la bande (ou la longe) : elle se serre ; une fois seule, elle se rouvre. */
  function serrer(h: number): void {
    for (const g of options.bandes ?? []) {
      const chef = agents[g[0]]
      let proche = 0
      for (const b of agents) {
        if (b.bande === chef.bande || b.cote !== chef.cote) continue
        for (const k of g) {
          const a = agents[k]
          const ds = enroulerDiff(b.s - a.s)
          if (Math.abs(b.x - a.x) < 1.6 && Math.abs(ds) < 5 && (ds * -a.sens > -1 || b.sens !== a.sens)) proche = 1
        }
      }
      chef.serrage += (proche - chef.serrage) * Math.min(1, h * (proche ? 2.5 : 0.8))
    }
  }

  function voisins(a: Etat): Voisin[] {
    const out: Voisin[] = []
    for (const b of agents) {
      if (b === a || b.cote !== a.cote) continue
      const ds = enroulerDiff(b.s - a.s)
      if (Math.abs(ds) > 12) continue
      out.push({ b, dx: b.x - a.x, ds, vx: b.vx, vs: b.vs, r: MARCHE.rayon })
    }
    // la caméra recule dans le repère de la rue : un obstacle qui bouge, plus large qu'un corps
    const dsc = enroulerDiff(camera.z - defile - a.s)
    const dxc = camera.x - a.x
    if (Math.abs(dsc) < 12 && Math.abs(dxc) < 3) out.push({ b: null, dx: dxc, ds: dsc, vx: 0, vs: -vRue, r: 0.65 })
    for (const o of statiques) {
      const ds = enroulerDiff(o.s - a.s)
      const dx = o.x - a.x
      if (Math.abs(ds) < 12 && Math.abs(dx) < 3) out.push({ b: null, dx, ds, vx: 0, vs: 0, r: o.r })
    }
    return out
  }

  function pas(h: number): void {
    horloge += h
    serrer(h)
    const centres = new Map<readonly number[], number>()
    for (const g of options.bandes ?? []) centres.set(g, g.reduce((t, k) => t + agents[k].x, 0) / g.length)
    const centre = (b: Etat): number => (b.bande ? (centres.get(b.bande) ?? b.x) : b.x)
    const R = MARCHE.rayon
    const desirs: {
      a: Etat
      vxFile: number
      vxEvite: number
      vsD: number
      buste: number
      regard: Voisin | null
    }[] = []
    for (const a of agents) {
      const f = -a.sens // sens de marche le long de s
      const [x0, x1] = MARCHE.trottoirs[a.cote]
      let vxEvite = 0
      let allonge = 1
      let vCap = Infinity
      let buste = 0
      let regard: Voisin | null = null
      let evite = 0
      const vers: number[] = []
      // en bande : garder sa place à côté des autres (la file de la bande suit leurs écarts)
      let xCible = a.xPref
      let vsCorr = 0
      if (a.bande && a.place) {
        const chef = agents[a.bande[0]]
        let cx = 0
        let cs = 0
        for (const k of a.bande) {
          const b = agents[k]
          cx += b.x - placeDe(b).dx
          cs += enroulerDiff(b.s - chef.s) + b.sens * placeDe(b).ds
        }
        cx /= a.bande.length
        cs = chef.s + cs / a.bande.length
        const ici = placeDe(a)
        xCible = 0.5 * chef.xBande + 0.5 * cx + ici.dx
        vsCorr = borne(enroulerDiff(cs + f * ici.ds - a.s) * 0.9, -0.35, 0.35)
      }
      for (const n of voisins(a)) {
        if (a.bande && n.b && n.b.bande === a.bande) continue
        const px = n.dx
        const ps = n.ds
        const dist = Math.hypot(px, ps)
        const memeSens = n.b !== null && n.b.sens === a.sens
        // côte à côte avec un inconnu : le plus lent laisse filer l'autre (à allure égale, celui de
        // derrière), qui allonge le pas. Le plus rapide ne cède jamais : sinon personne ne double.
        if (n.b && memeSens && Math.abs(ps) < 1.4 && Math.abs(px) < 1.1) {
          const ecart = a.vPref - n.b.vPref
          const ilEstDevant = ps * f > 0.05 || (Math.abs(ps) <= 0.05 && n.b.i < a.i)
          const jeCede = ecart < -0.06 || (Math.abs(ecart) <= 0.06 && ilEstDevant)
          if (jeCede) vCap = Math.min(vCap, Math.max(0, n.vs * f - 0.3))
          else allonge = 1.08
        }
        // quelqu'un devant, dans le même sens et la même file : doubler par la gauche, ou suivre
        if (n.b && memeSens && ps * f > 0 && ps * f < 3.2 && Math.abs(px) < 2 * R + 0.2 && n.b.vitesse > 0.15) {
          const vDevant = n.vs * f
          const gauche = a.sens === 1 ? -1 : 1
          const xDouble = a.x + gauche * 0.8
          const place = gauche > 0 ? x1 - xDouble - R : xDouble - R - x0
          // une bande ne double pas : elle suit
          if (!a.bande && a.vPref > vDevant + 0.06 && place > 0) {
            vxEvite += gauche * 0.55 * (1 - borne((Math.abs(ps) - 1.2) / 2, 0, 1) * 0.5)
          } else {
            vCap = Math.min(vCap, Math.max(0, vDevant + (Math.abs(ps) - 1.1) * 0.9))
          }
          continue
        }
        const wx = a.vx - n.vx
        const ws = a.vs - n.vs
        const w2 = wx * wx + ws * ws
        const tc = w2 > 1e-6 ? (px * wx + ps * ws) / w2 : 0
        const besoin = R + n.r + MARCHE.marge
        // contact imminent : on s'écarte, même sans mouvement relatif
        if (dist < besoin) vxEvite -= Math.sign(px || 1e-3) * ((besoin - dist) / besoin) * 1.1
        // à hauteur de l'autre, on ne revient pas vers sa file À TRAVERS lui
        if (Math.abs(ps) < 1.2 && Math.abs(px) < besoin + 0.3) vers.push(Math.sign(px))
        if (tc <= 0 || tc > MARCHE.horizon) continue
        const cx = px - wx * tc
        const cs = ps - ws * tc
        const dmin = Math.hypot(cx, cs)
        // on vise un peu plus large que le besoin : sinon, l'écart à peine suffisant, le retour vers
        // sa file ramène les deux corps l'un contre l'autre au moment de se croiser
        const vise = besoin + MARCHE.aisance
        if (dmin >= vise) continue
        const urgence = (1 - tc / MARCHE.horizon) * ((vise - dmin) / vise)
        evite += urgence
        // passer à l'opposé de là où il sera ; de face, chacun prend sa droite. Une bande compte pour
        // UN corps large : le côté se choisit entre les centres des bandes, pas membre par membre.
        const cxCentres = cx + ((n.b ? centre(n.b) : 0) - (n.b?.x ?? 0)) - (centre(a) - a.x)
        let cote = -Math.sign(cxCentres)
        if (Math.abs(cxCentres) < 0.08) cote = a.sens === 1 ? 1 : -1
        const devant = ps * f > 0
        if (memeSens && devant && n.b && n.b.vitesse > 0.15) continue
        // un corps immobile (figurant, caméra) : on le contourne du côté où il y a la place
        if (!n.b || n.b.vitesse < 0.15) {
          const xo = a.x + px
          cote = x1 - (xo + n.r + R) > xo - n.r - R - x0 ? 1 : -1
        }
        vxEvite += cote * urgence * 1.6
        if (n.b && dist < 2.2) {
          buste = Math.max(buste, (1 - dist / 2.2) * MARCHE.buste)
          a.coteBuste = Math.sign(px) * (a.sens === 1 ? 1 : -1)
        }
        if (n.b && dist > 1.5 && dist < 7 && devant && !regard) regard = n
      }
      // vitesse voulue : revenir à sa file (pas pendant qu'on s'écarte, ni à travers celui qu'on
      // croise), et s'écarter
      let vxFile = borne((xCible - a.x) * 1.2, -0.45, 0.45) * Math.max(0, 1 - 4 * evite)
      if (vers.includes(Math.sign(vxFile))) vxFile = 0
      const vsD = f * Math.min(a.vPref * allonge, vCap) + vsCorr
      desirs.push({ a, vxFile, vxEvite, vsD, buste, regard })
    }

    // UNE BANDE S'ÉCARTE D'UN BLOC : chaque membre prend l'écart moyen des siens. Sinon chacun
    // s'écarte de son côté, la bande s'ouvre et celui qui arrive passe au milieu (mesuré, conv-331).
    for (const g of options.bandes ?? []) {
      const membres = desirs.filter((d) => d.a.bande === g)
      const moyen = membres.reduce((t, d) => t + d.vxEvite, 0) / membres.length
      for (const d of membres) d.vxEvite = moyen
    }

    // intégration : un corps ne change pas de cap d'un coup (accélérations bornées)
    for (const { a, vxFile, vxEvite, vsD: vsVoulu, buste, regard } of desirs) {
      // ne pas foncer en s'écartant
      let vxD = borne(vxFile + vxEvite, -1.1, 1.1)
      let vsD = vsVoulu
      const vTot = Math.hypot(vxD, vsD)
      const vMax = Math.max(0.01, a.vPref * 1.25)
      if (vTot > vMax) {
        vxD *= vMax / vTot
        vsD *= vMax / vTot
      }
      a.vx += borne(vxD - a.vx, -1.6 * h, 1.6 * h)
      a.vs += borne(vsD - a.vs, -1.2 * h, 1.2 * h)
      a.x += a.vx * h
      a.s += a.vs * h
      const [x0, x1] = MARCHE.trottoirs[a.cote]
      if (a.x < x0) {
        a.x = x0
        a.vx = Math.max(0, a.vx)
      }
      if (a.x > x1) {
        a.x = x1
        a.vx = Math.min(0, a.vx)
      }
      a.vitesse = Math.hypot(a.vx, a.vs)
      a.buste += (buste * a.coteBuste - a.buste) * Math.min(1, h * 5)
      // le coup d'œil : vers celui qui arrive, de temps en temps, une à deux secondes
      if (regard && regard.b && horloge > a.prochainRegard) {
        a.regardFin = horloge + 1.2 + rnd() * 1.2
        a.regardQui = regard.b
        a.prochainRegard = horloge + 4 + (rnd() * 6) / MARCHE.regard
      }
      let regardVise = 0
      if (a.regardQui && horloge < a.regardFin) {
        const b = a.regardQui
        regardVise = borne(angleDiff(Math.atan2(b.x - a.x, enroulerDiff(b.s - a.s)) - a.yaw), -1, 1)
      } else if (a.bande && Math.sin(horloge * 0.5 + a.i * 1.7) > 0.35) {
        // en bande, on se parle : la tête se tourne vers le voisin, par moments
        const autre = agents[a.bande[(a.bande.indexOf(a.i) + 1) % a.bande.length]]
        regardVise = borne(angleDiff(Math.atan2(autre.x - a.x, enroulerDiff(autre.s - a.s)) - a.yaw), -1.1, 1.1)
      }
      a.regard += (regardVise - a.regard) * Math.min(1, h * 4)
      // le cap suit la trajectoire : il s'écarte en marchant de travers, pas en pas chassés
      if (a.vitesse > 0.2) {
        const dy = angleDiff(Math.atan2(a.vx, a.vs) - a.yaw)
        a.yaw += borne(dy * Math.min(1, h * 5), -2.6 * h, 2.6 * h)
      }
    }

    separer(3)
  }

  /** Séparation dure : aucun corps n'entre dans un autre, ni dans un figurant. */
  function separer(iterations: number): void {
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < agents.length; i++) {
        const a = agents[i]
        for (let j = i + 1; j < agents.length; j++) {
          const b = agents[j]
          if (a.cote !== b.cote) continue
          const ds = enroulerDiff(b.s - a.s)
          const dx = b.x - a.x
          const d = Math.hypot(dx, ds)
          if (d >= MARCHE.ecartMin || d < 1e-6) continue
          const k = (MARCHE.ecartMin - d) / 2
          // surtout de côté : on ne recule pas dans la marche de l'autre
          a.x -= (dx / d) * k * 1.2
          b.x += (dx / d) * k * 1.2
          a.s -= (ds / d) * k * 0.6
          b.s += (ds / d) * k * 0.6
        }
        for (const o of statiques) {
          const ds = enroulerDiff(a.s - o.s)
          const dx = a.x - o.x
          const d = Math.hypot(dx, ds)
          const min = MARCHE.rayon + o.r + 0.08
          if (d >= min || d < 1e-6) continue
          a.x += (dx / d) * (min - d)
          a.s += (ds / d) * (min - d) * 0.5
        }
      }
      // poussé ou pas, on reste sur son trottoir (la séparation le fait glisser le long de l'autre)
      for (const a of agents) {
        const [x0, x1] = MARCHE.trottoirs[a.cote]
        a.x = borne(a.x, x0, x1)
      }
    }
  }

  // Les places de départ (les files de `positionZ`) peuvent se chevaucher : on les écarte d'emblée.
  separer(12)

  return {
    marcheurs: agents,
    z: (m) => enroulerZ(m.s + defile),
    avancer(dt, nouveauDefile, obstacles = []) {
      if (dt > 0) vRue = (nouveauDefile - defile) / dt
      defile = nouveauDefile
      statiques = obstacles.map((o) => ({ x: o.x, s: o.z - defile, r: o.r }))
      const n = Math.ceil(dt / MARCHE.pas - 1e-9)
      for (let k = 0; k < n; k++) pas(dt / n)
    }
  }
}
