// Le film : un teaser de jeu vidéo. L'intro finit, sur un éclair blanc, là où la boucle commence.
const IMAGES_PAR_SECONDE = 24
const BOUCLE = 12
const DUREE_INTRO = 14
const IMAGES_INTRO = DUREE_INTRO * IMAGES_PAR_SECONDE
// La boucle : 4 temps de 10 s, qui montent en puissance jusqu'au tunnel. Chaque temps ouvre sur le
// plan large, où le mage frappe le sol et où le cercle invoque un sort, puis enchaîne des plans
// serrés. Ces durées sont aussi celles de teaser-accueil-calcul.ts, qui y cale les phrases.
const DUREE_TEMPS = 10
const NOMBRE_TEMPS = 4
const COUP_DE_BATON = 0.52
const FIN_DU_LARGE = 6
const IMAGES_BOUCLE = DUREE_TEMPS * NOMBRE_TEMPS * IMAGES_PAR_SECONDE
// Le plan large. La caméra y tourne autour du cercle de runes, qui reste ainsi à la même place à
// l'écran : c'est de là que l'interface fait partir ses lettres.
const POSE = { cam: [0, 3.4, 16], cible: [0, 4.9, -12], fov: 44 }
const CERCLE = [0, 0, -0.6]
const AU_CIEL = [0, 14.4, -24.2]

const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t))
const borne = (x) => Math.min(1, Math.max(0, x))
const lisse = (a, b, x) => {
  const t = borne((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const sortie = (t) => 1 - Math.pow(1 - t, 3)
const entree = (t) => t * t * t
const entre = (s, d, f, m = 0.12) => Math.min(borne((s - d) / m), borne((f - s) / m))

const FINAL = {
  fenetre: 1,
  cercle: 1,
  balaye: 1,
  yeux: 1,
  brume: 1,
  grains: 1,
  fondu: 1,
  flash: 0,
  bandes: 0,
  titre: 0
}

/** Tourne un point autour de l'axe vertical du cercle de runes. */
function autourDuCercle([x, y, z], angle) {
  const c = Math.cos(angle),
    s = Math.sin(angle),
    dx = x - CERCLE[0],
    dz = z - CERCLE[2]
  return [CERCLE[0] + dx * c - dz * s, y, CERCLE[2] + dx * s + dz * c]
}

/** Où tombe un point à l'écran, de 0 à 1 : l'onde de choc et le flou y prennent leur centre. */
function aLEcran(P, cam, cible, fov) {
  const sous = (a, b) => a.map((v, i) => v - b[i])
  const scal = (a, b) => a.reduce((t, v, i) => t + v * b[i], 0)
  const croix = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ]
  const unite = (a) => {
    const l = Math.hypot(...a)
    return a.map((v) => v / l)
  }
  const f = unite(sous(cible, cam)),
    r = unite(croix(f, [0, 1, 0])),
    u = croix(r, f),
    v = sous(P, cam),
    z = Math.max(scal(v, f), 0.1),
    k = 1 / Math.tan(((fov / 2) * Math.PI) / 180)
  return [0.5 + ((scal(v, r) * k) / z) * (9 / 16) * 0.5, 0.5 + ((scal(v, u) * k) / z) * 0.5]
}

/** Une secousse qui s'éteint : une somme de sinus, jamais de hasard, donc la même à chaque rendu. */
function secousse(age, force, n) {
  if (age < 0) return [0, 0, 0]
  const e = force * Math.exp(-age * 3.2)
  return [
    e * (Math.sin(n * 2.1) + 0.5 * Math.sin(n * 5.3)),
    e * (Math.sin(n * 2.9 + 1) + 0.5 * Math.sin(n * 6.1)),
    e * 0.4 * Math.sin(n * 3.7 + 2)
  ]
}

/** Le coup de bâton, dont tout découle. */
function coup(r, n) {
  const apres = Math.max(0, r - COUP_DE_BATON)
  const frappe = lisse(COUP_DE_BATON - 0.05, COUP_DE_BATON + 0.03, r)
  return {
    apres,
    frappe,
    reglages: {
      geste: r < COUP_DE_BATON ? lisse(0, 0.45, r) : Math.exp(-apres * 0.5),
      baton: lisse(0, 0.42, r) * (1 - frappe) * 1.5,
      souffle: frappe * Math.exp(-apres * 1.1),
      invoque: 1.15 * frappe * Math.exp(-apres * 1.15),
      onde: frappe * borne(apres / 2.4),
      fenetre: 1 + 0.4 * frappe * Math.exp(-apres * 1.3),
      yeux: 1 + 1.4 * frappe * Math.exp(-apres * 1.2),
      flash: 0.34 * frappe * Math.exp(-apres * 11),
      chocAge: frappe > 0 ? apres : 99,
      chocOnde: frappe > 0 && apres < 1.5 ? apres / 1.5 : 0
    },
    tremble: secousse(frappe > 0 ? apres : -1, 0.14, n)
  }
}

// Ce que chaque temps ajoute au coup de bâton, d'après le temps écoulé dans le plan.
const EVENEMENTS = [
  // 1 · la frappe : rien que la force, tout le reste vient après
  () => ({ orbite: 0.11 }),
  // 2 · l'astrolabe s'ouvre, les dalles s'arrachent du sol
  (r) => ({
    orbite: -0.12,
    anneaux: 0.18 + 0.82 * sortie(lisse(0.5, 2.6, r)),
    pierres: lisse(0.55, 4.6, r)
  }),
  // 3 · l'éclipse : la lumière s'en va, la foudre arrive
  (r) => ({
    orbite: 0.1,
    anneaux: 1,
    pierres: 1,
    eclipse: lisse(0.55, 2.6, r),
    fenetre: 1 - 0.35 * lisse(0.6, 2.6, r),
    foudre: lisse(1.6, 2.4, r) * (0.7 + 0.3 * Math.sin(r * 31)),
    yeux: 2.2
  }),
  // 4 · le temps s'affole : les aiguilles repartent à l'envers, le disque s'ouvre
  (r) => ({
    orbite: -0.1,
    anneaux: 1,
    pierres: 1,
    aiguilles: entree(lisse(0.5, 5.8, r)) * 9,
    vortex: lisse(1.2, 4.5, r),
    foudre: lisse(3.2, 4.6, r) * (0.75 + 0.25 * Math.sin(r * 37)),
    yeux: 1.8
  })
]

// Les plans serrés : [départ, fin] dans le temps, caméra de `cam[0]` à `cam[1]`, et leurs réglages.
const SERRES = [
  [
    // le bâton frappe : la caméra est à terre
    {
      d: 6,
      f: 7.3,
      cam: [
        [6.1, 3.7, -8.9],
        [5.5, 3.62, -9.6]
      ],
      cible: [2.9, 4.5, -12.8],
      fov: 46,
      frappeA: 6.42,
      impact: [2.9, 3.4, -12.8]
    },
    // poussée sur les yeux
    {
      d: 7.3,
      f: 8.6,
      cam: [
        [0.5, 7.4, -4.4],
        [0.06, 8.05, -10.5]
      ],
      cible: [0, 8.55, -12.6],
      fov: 30,
      accelere: true,
      fenetre: 0.55,
      cercle: 0,
      yeux: 1.6,
      flouFin: 0.5,
      centre: [0.5, 0.42]
    },
    // les aiguilles repartent à l'envers
    {
      d: 8.6,
      f: 10,
      cam: [
        [-3.4, 18.4, -15.5],
        [-3.9, 18.2, -18]
      ],
      cible: [-5.4, 20.2, -24.2],
      fov: 40,
      cercle: 0,
      aiguilles: (p) => p * 3
    }
  ],
  [
    // l'astrolabe passe devant l'objectif
    {
      d: 6,
      f: 7.4,
      cam: [
        [6.6, 9.8, -7.8],
        [5.8, 10.8, -8.8]
      ],
      cible: [-1.2, 9, -13.2],
      fov: 36,
      anneaux: 1,
      pierres: 1
    },
    // on file entre les dalles
    {
      d: 7.4,
      f: 8.7,
      cam: [
        [1.2, 5.2, 9],
        [-0.8, 7, -3.2]
      ],
      cible: [0, 11, -24],
      fov: 46,
      anneaux: 1,
      pierres: 1,
      accelere: true
    },
    // le cercle vu du ciel
    {
      d: 8.7,
      f: 10,
      cam: [
        [1.6, 15, 3.4],
        [0.9, 11.5, 2.2]
      ],
      cible: CERCLE,
      fov: 50,
      anneaux: 1,
      pierres: 1,
      invoque: 0.1,
      brume: 0.25,
      roulis: (p) => 0.9 - p * 0.5
    }
  ],
  [
    // le chapeau sur l'éclipse
    {
      d: 6,
      f: 7.5,
      cam: [
        [-2.1, 4.9, -3.6],
        [-1.1, 5.4, -5.3]
      ],
      cible: [0.5, 12.2, -14],
      fov: 36,
      eclipse: 1,
      fenetre: 0.7,
      yeux: 2.2,
      cercle: 0,
      anneaux: 1
    },
    // la main levée : la foudre part de là
    {
      d: 7.5,
      f: 8.8,
      cam: [
        [-5.4, 9.8, -6.2],
        [-4.5, 10.5, -7.6]
      ],
      cible: [-1.7, 11.8, -12.6],
      fov: 34,
      geste: 1,
      eclipse: 1,
      fenetre: 0.7,
      yeux: 2.6,
      foudre: 1,
      anneaux: 1,
      cercle: 0
    },
    // la roue en ombre chinoise sur la couronne de l'éclipse
    {
      d: 8.8,
      f: 10,
      cam: [
        [-8.8, 9.2, 2.2],
        [-8.9, 10, -0.8]
      ],
      cible: [-3.2, 14.2, -24],
      fov: 32,
      eclipse: 1,
      fenetre: 0.9,
      foudre: 0.8,
      anneaux: 1
    }
  ]
]

function planLarge(n, s, temps, r) {
  const { reglages, tremble } = coup(r, n)
  const { orbite, ...evenement } = EVENEMENTS[temps](r)
  const angle = orbite * (r / FIN_DU_LARGE - 0.5) * 2
  const cam = autourDuCercle(POSE.cam, angle).map((v, i) => v + tremble[i])
  const cible = autourDuCercle(POSE.cible, angle).map((v, i) => v + tremble[i] * 0.4)
  const fenetre = reglages.fenetre * (evenement.fenetre ?? 1)
  return {
    t: s,
    ...FINAL,
    ...reglages,
    ...evenement,
    fenetre,
    yeux: Math.max(reglages.yeux, evenement.yeux ?? 1),
    cam,
    cible,
    fov: POSE.fov,
    roulis: tremble[2] * 0.05,
    centre: aLEcran(CERCLE, cam, cible, POSE.fov)
  }
}

function planSerre(n, s, plan, r) {
  const {
    cam,
    cible,
    fov,
    d,
    f,
    frappeA,
    impact,
    accelere,
    flouFin,
    roulis,
    aiguilles,
    ...reglages
  } = plan
  const brut = (r - d) / (f - d)
  const p = accelere ? entree(borne(brut)) : lisse(-0.4, 1.4, brut)
  let position = lerp3(cam[0], cam[1], p)
  let visee = cible
  const etat = {
    t: s,
    ...FINAL,
    ...reglages,
    bandes: 1,
    passes: accelere ? 5 : 3,
    flash: 0.16 * Math.exp(-(r - d) * 30)
  }
  if (frappeA !== undefined) {
    // Le bâton monte puis retombe, vu d'en bas : un coup à lui, avec ses éclats.
    const age = r - frappeA
    const frappe = lisse(-0.05, 0.03, age)
    const tremble = secousse(frappe > 0 ? age : -1, 0.1, n)
    position = position.map((v, i) => v + tremble[i])
    visee = visee.map((v, i) => v + tremble[i] * 0.5)
    Object.assign(etat, {
      geste: age < 0 ? lisse(-0.42, -0.02, age) : Math.exp(-age * 0.5),
      baton: lisse(-0.42, -0.05, age) * (1 - frappe) * 1.5,
      souffle: frappe * Math.exp(-Math.max(age, 0) * 1.1),
      flash: 0.3 * frappe * Math.exp(-Math.max(age, 0) * 12),
      chocAge: frappe > 0 ? age : 99,
      chocPos: impact,
      chocOnde: frappe > 0 && age < 1 ? age : 0,
      centre: aLEcran(impact, position, visee, fov)
    })
  }
  if (flouFin) etat.flouRadial = flouFin * entree(borne(brut))
  if (roulis) etat.roulis = roulis(brut)
  if (aiguilles) etat.aiguilles = aiguilles(brut)
  return { ...etat, cam: position, cible: visee, fov }
}

function planDeLaBoucle(n) {
  const s = (n - IMAGES_INTRO) / IMAGES_PAR_SECONDE
  const temps = Math.min(Math.floor(s / DUREE_TEMPS), NOMBRE_TEMPS - 1)
  const r = s - temps * DUREE_TEMPS
  if (r < FIN_DU_LARGE) return planLarge(n, s, temps, r)
  if (temps < NOMBRE_TEMPS - 1) {
    const plan = SERRES[temps].find((c) => r < c.f) ?? SERRES[temps][2]
    return planSerre(n, s, plan, r)
  }
  // 4 · on fonce dans le disque, on le traverse, et c'est le tunnel du temps
  const FONCE = 7.5
  if (r < FONCE) {
    const p = (r - FIN_DU_LARGE) / (FONCE - FIN_DU_LARGE)
    const e = entree(p)
    const position = [
      Math.sin(p * Math.PI) * -6.2,
      lerp(3.4, 14.4, Math.pow(p, 1.5)),
      lerp(16, -21.5, e)
    ]
    return {
      t: s,
      ...FINAL,
      passes: 6,
      anneaux: 1,
      pierres: 1,
      vortex: 1,
      aiguilles: 9 + p * 3,
      foudre: 0.9,
      yeux: 1.8,
      cam: position,
      cible: lerp3(POSE.cible, AU_CIEL, lisse(0, 0.4, p)),
      fov: lerp(POSE.fov, 74, e),
      flouRadial: 0.55 * e,
      flash: 2.4 * Math.pow(p, 16),
      bandes: 1 - lisse(0, 0.3, p),
      roulis: 0.25 * e
    }
  }
  const q = (r - FONCE) / (DUREE_TEMPS - FONCE)
  return {
    t: s,
    ...FINAL,
    passes: 4,
    tunnel: 8 + (r - FONCE) * 62 * (1 + q * 0.8),
    cam: [0.05 * Math.sin(r * 2.3), 0.04 * Math.sin(r * 1.7), 0],
    cible: [0.1 * Math.sin(r * 1.1), 0.08 * Math.cos(r * 1.3), -1],
    fov: 86,
    roulis: 0.2 * Math.sin(r * 1.2),
    flouRadial: 0.12 + 0.14 * q,
    flash: 1.6 * Math.exp(-(r - FONCE) * 7) + 3 * Math.pow(q, 8)
  }
}

function etat(n) {
  if (n >= IMAGES_INTRO) return planDeLaBoucle(n)
  const s = n / IMAGES_PAR_SECONDE
  const t = s - DUREE_INTRO
  // 1 · dans le noir, le cercle s'allume, vu du ciel
  if (s < 2.8) {
    const p = s / 2.8
    return {
      t,
      ...FINAL,
      cam: lerp3([0.02, 9.5, -0.6], [0.02, 6.4, -0.6], lisse(0, 1, p)),
      cible: CERCLE,
      fov: 46,
      roulis: 0.5 - p * 0.45,
      fenetre: 0.08,
      cercle: 0.55,
      yeux: 0,
      balaye: lisse(0.08, 0.95, p),
      brume: 0.35,
      grains: 0.8,
      bandes: 1,
      fondu: Math.min(borne(s / 0.5), borne((2.8 - s) / 0.08))
    }
  }
  // 2 · l'horloge : la trotteuse tremble, le temps ne repart pas
  if (s < 4.2) {
    const p = (s - 2.8) / 1.4
    return {
      t,
      ...FINAL,
      cam: lerp3([3.4, 14.6, -16.5], [3.9, 15.2, -18.6], p),
      cible: [5.9, 17.6, -24.2],
      fov: 34,
      fenetre: 0.9,
      cercle: 0,
      yeux: 0,
      grains: 0.8,
      bandes: 1,
      fondu: entre(s, 2.8, 4.2, 0.06)
    }
  }
  // 3 · la roue, puis le balancier qui passe sur la lune
  if (s < 5.4) {
    const p = (s - 4.2) / 1.2
    return {
      t,
      ...FINAL,
      cam: lerp3([-8.8, 9.4, 1.8], [-8.9, 10, -0.8], p),
      cible: [-3.2, 14.2, -24],
      fov: 32,
      cercle: 0,
      yeux: 0,
      bandes: 1,
      fondu: entre(s, 4.2, 5.4, 0.06)
    }
  }
  // 4 · sous le chapeau, deux braises s'ouvrent
  if (s < 7.2) {
    const p = (s - 5.4) / 1.8
    const y = lisse(0.3, 0.46, p)
    return {
      t,
      ...FINAL,
      cam: lerp3([0.22, 7.95, -9.4], [0.04, 8.08, -10.6], p),
      cible: [0, 8.55, -12.6],
      fov: 30,
      fenetre: 0.55,
      cercle: 0,
      yeux: y * 1.5,
      flash: 0.14 * Math.exp(-Math.max(0, p - 0.42) * 22) * y,
      bandes: 1,
      fondu: entre(s, 5.4, 7.2, 0.08)
    }
  }
  // le titre, sur le noir
  if (s < 9.4) {
    return {
      t,
      ...POSE,
      ...FINAL,
      noir: true,
      fondu: 0,
      titre: entre(s, 7.3, 9.3, 0.45),
      sillage: lerp(-0.3, 1.3, (s - 7.5) / 1.5),
      bandes: 1
    }
  }
  // 5 · le coup qui réveille tout : la nef se révèle, on recule jusqu'au plan large
  const p = (s - 9.4) / (DUREE_INTRO - 9.4),
    e = sortie(p)
  return {
    t,
    ...FINAL,
    cam: lerp3([0, 1.05, 5], POSE.cam, e),
    cible: lerp3([0, 9.2, -24], POSE.cible, e),
    fov: lerp(62, POSE.fov, e),
    fenetre: lisse(0, 0.3, p),
    flash: 0.6 * Math.exp(-p * 20) + 0.5 * Math.pow(p, 40),
    bandes: 1 - lisse(0.1, 0.6, p),
    chocAge: s - 9.4,
    chocOnde: p < 0.3 ? p / 0.3 : 0,
    centre: [0.5, 0.2],
    invoque: 0.8 * Math.exp(-p * 7)
  }
}
module.exports = {
  etat,
  IMAGES_PAR_SECONDE,
  BOUCLE,
  POSE,
  DUREE_INTRO,
  IMAGES_INTRO,
  IMAGES_BOUCLE
}
