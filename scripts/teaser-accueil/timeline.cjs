// Le film : une intro en plans coupés, qui finit exactement sur la première image de la boucle.
const IMAGES_PAR_SECONDE = 24
const BOUCLE = 12
const DUREE_INTRO = 11
const IMAGES_INTRO = DUREE_INTRO * IMAGES_PAR_SECONDE
// La boucle : 4 temps de 10 s. Chaque temps ouvre sur le plan large, où le cercle invoque une phrase,
// puis enchaîne deux plans serrés. Le temps suivant repart sur une coupe : aucun raccord à soigner.
// Ces durées sont aussi celles de teaser-accueil-calcul.ts, qui y cale les phrases.
const DUREE_TEMPS = 10
const NOMBRE_TEMPS = 4
const COUP_DE_BATON = 0.52
const FIN_DU_LARGE = 7
const FIN_DU_PREMIER_SERRE = 8.5
const IMAGES_BOUCLE = DUREE_TEMPS * NOMBRE_TEMPS * IMAGES_PAR_SECONDE
// Le plan large : celui où le cercle invoque les phrases.
const POSE = { cam: [0, 3.4, 16], cible: [0, 4.9, -12], fov: 44 }

const lerp = (a, b, t) => a + (b - a) * t
const lerp3 = (a, b, t) => a.map((v, i) => lerp(v, b[i], t))
const borne = (x) => Math.min(1, Math.max(0, x))
const lisse = (a, b, x) => {
  const t = borne((x - a) / (b - a))
  return t * t * (3 - 2 * t)
}
const sortie = (t) => 1 - Math.pow(1 - t, 3)
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

// Les plans serrés : [départ de la caméra, arrivée, cible, champ, réglages].
const SERRES = [
  [
    // la roue de gauche en ombre chinoise sur le cadran
    {
      cam: [
        [-8.8, 9.2, 2.2],
        [-8.9, 10, -0.8]
      ],
      cible: [-3.2, 14.2, -24],
      fov: 32
    },
    // les chiffres de l'horloge, la trotteuse qui tremble
    {
      cam: [
        [3.4, 14.6, -16.5],
        [3.9, 15.2, -18.6]
      ],
      cible: [5.9, 17.6, -24.2],
      fov: 34,
      cercle: 0
    }
  ],
  [
    // les yeux sous le chapeau
    {
      cam: [
        [0.22, 7.95, -9.2],
        [0.04, 8.08, -10.4]
      ],
      cible: [0, 8.55, -12.6],
      fov: 30,
      fenetre: 0.6,
      cercle: 0,
      yeux: 1.25
    },
    // le chapeau découpé sur la lune
    {
      cam: [
        [-2.6, 5.4, -3.4],
        [-1.2, 5.8, -5.4]
      ],
      cible: [0.5, 11.6, -13.2],
      fov: 34,
      cercle: 0,
      yeux: 1.25
    }
  ],
  [
    // l'escalier et ses cierges, en montant vers lui
    {
      cam: [
        [1.8, 2.5, 4.4],
        [0.8, 3.5, 0.6]
      ],
      cible: [0, 6.6, -13.2],
      fov: 38,
      yeux: 1.2
    },
    // le sable qui remonte du cercle, au ras du sol
    {
      cam: [
        [2.6, 2.2, 3.2],
        [1.3, 1.6, 2.3]
      ],
      cible: [0.2, 0.2, -0.6],
      fov: 40,
      cercle: 0.5,
      brume: 0.5
    }
  ],
  [
    // l'anneau du bâton sur le cadran
    {
      cam: [
        [3.7, 12.3, -6.2],
        [3.2, 12.9, -8.6]
      ],
      cible: [2.9, 13.3, -12.8],
      fov: 30,
      cercle: 0,
      fenetre: 0.55
    },
    // la roue de droite, de l'autre côté de la nef
    {
      cam: [
        [9.4, 9.8, 3.4],
        [9.2, 10.6, 0.2]
      ],
      cible: [3.6, 15.2, -24],
      fov: 32
    }
  ]
]

function planDeLaBoucle(n) {
  const s = (n - IMAGES_INTRO) / IMAGES_PAR_SECONDE
  const t = s
  const temps = Math.floor(s / DUREE_TEMPS)
  const r = s - temps * DUREE_TEMPS
  if (r < FIN_DU_LARGE) {
    // Le mage lève la main et son bâton, frappe le sol : c'est lui qui réveille le cercle. La caméra
    // ne bouge pas : les lettres de l'interface partent du cercle.
    const apres = Math.max(0, r - COUP_DE_BATON)
    const frappe = lisse(COUP_DE_BATON - 0.05, COUP_DE_BATON + 0.03, r)
    return {
      t,
      ...POSE,
      ...FINAL,
      geste: r < COUP_DE_BATON ? lisse(0, 0.45, r) : Math.exp(-apres * 0.5),
      baton: lisse(0, 0.42, r) * (1 - frappe) * 1.5,
      souffle: frappe * Math.exp(-apres * 1.1),
      invoque: 1.15 * frappe * Math.exp(-apres * 1.15),
      onde: frappe * borne(apres / 2.4),
      fenetre: 1 + 0.4 * frappe * Math.exp(-apres * 1.3),
      yeux: 1 + 1.4 * frappe * Math.exp(-apres * 1.2),
      flash: 0.22 * frappe * Math.exp(-apres * 12)
    }
  }
  const premier = r < FIN_DU_PREMIER_SERRE
  const [d, f] = premier
    ? [FIN_DU_LARGE, FIN_DU_PREMIER_SERRE]
    : [FIN_DU_PREMIER_SERRE, DUREE_TEMPS]
  const { cam, ...reglages } = SERRES[temps % NOMBRE_TEMPS][premier ? 0 : 1]
  const p = lisse(-0.4, 1.4, (r - d) / (f - d))
  return {
    t,
    ...FINAL,
    ...reglages,
    cam: lerp3(cam[0], cam[1], p),
    bandes: 1,
    fondu: entre(r, d, f, 0.07)
  }
}

function etat(n) {
  if (n >= IMAGES_INTRO) return planDeLaBoucle(n)
  const s = n / IMAGES_PAR_SECONDE
  const t = s - DUREE_INTRO
  // 1 · les runes s'allument une à une, au ras du sol
  if (s < 2.6) {
    const p = s / 2.6,
      e = lisse(0, 1, p)
    return {
      t,
      ...FINAL,
      cam: lerp3([2.6, 2.2, 3.2], [1.2, 1.5, 2.2], e),
      cible: [lerp(0.5, 0, e), 0, -0.6],
      fov: 40,
      fenetre: 0.1,
      cercle: 0.45,
      yeux: 0,
      balaye: lisse(0.08, 0.95, p),
      brume: 0.35,
      grains: 0.8,
      bandes: 1,
      fondu: Math.min(borne(s / 0.5), borne((2.6 - s) / 0.1))
    }
  }
  // 2 · l'horloge : la trotteuse tremble, le temps ne repart pas
  if (s < 4.6) {
    const p = (s - 2.6) / 2
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
      fondu: entre(s, 2.6, 4.6)
    }
  }
  // 3 · sous le chapeau, deux braises s'ouvrent
  if (s < 6.6) {
    const p = (s - 4.6) / 2
    const y = lisse(0.34, 0.5, p)
    return {
      t,
      ...FINAL,
      cam: lerp3([0.22, 7.95, -9.4], [0.04, 8.08, -10.5], p),
      cible: [0, 8.55, -12.6],
      fov: 30,
      fenetre: 0.55,
      cercle: 0,
      yeux: y,
      flash: 0.1 * Math.exp(-Math.max(0, p - 0.42) * 22) * y,
      bandes: 1,
      fondu: entre(s, 4.6, 6.6)
    }
  }
  // le titre, sur le noir
  if (s < 8) {
    return { t, ...POSE, ...FINAL, noir: true, fondu: 0, titre: entre(s, 6.7, 7.9, 0.4), bandes: 1 }
  }
  // 4 · la nef entière se révèle ; arrivée exacte sur la pose de la boucle
  const p = (s - 8) / 3,
    e = sortie(p)
  return {
    t,
    ...FINAL,
    cam: lerp3([0, 1.05, 5], POSE.cam, e),
    cible: lerp3([0, 9.2, -24], POSE.cible, e),
    fov: lerp(60, POSE.fov, e),
    fenetre: lisse(0, 0.4, p),
    flash: 0.55 * Math.exp(-p * 16),
    bandes: 1 - lisse(0.1, 0.7, p)
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
