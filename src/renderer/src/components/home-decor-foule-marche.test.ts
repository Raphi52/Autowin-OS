import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { creerMarche, MARCHE, type Marche } from './home-decor-foule-marche'
import { CAMERA_AVENUE } from './home-decor-avenue'
import { enrouler, FOULE, HEURE_DE_POINTE, positionZ } from './home-decor-foule'

/*
 * LES PASSANTS NE SE RENTRENT PLUS DEDANS (conv-331, « Croisement anticipé »).
 * Constat de l'utilisateur : « ils se rentrent les uns dans les autres en mode mal fait quand ils
 * marchent ». Mesuré sur le vrai décor : 13 images sur 360 avec deux bassins à moins de 50 cm.
 */

// Ordre de grandeur des vitesses des clips (m/s) : le décor lit les vraies dans marches.glb.
const VITESSE = (marche: string): number => (/slow/.test(marche) ? 0.85 : /fast/.test(marche) ? 1.45 : 1.15)
const V_RUE = 0.45
const DT = 1 / 60
const DUREE = 150
const [CAM_X, , CAM_Z] = CAMERA_AVENUE.position
const defileA = (t: number): number => V_RUE * (t - FOULE.tRef)

/** Le pire rapprochement entre deux passants du même trottoir, et le nombre d'images sous 50 cm. */
function pire(positions: (t: number) => { x: number; z: number }[]): { min: number; sous50: number } {
  let min = Infinity
  let sous50 = 0
  for (let t = 20; t < 20 + DUREE; t += DT) {
    const P = positions(t)
    let sous = false
    for (let i = 0; i < P.length; i++)
      for (let j = i + 1; j < P.length; j++) {
        if (Math.sign(P[i].x) !== Math.sign(P[j].x)) continue
        let dz = P[i].z - P[j].z
        dz = ((((dz + 35) % 70) + 70) % 70) - 35
        const d = Math.hypot(P[i].x - P[j].x, dz)
        if (d < min) min = d
        if (d < 0.5) sous = true
      }
    if (sous) sous50++
  }
  return { min, sous50 }
}

function foule(): { marche: Marche; avancer: (t: number) => void } {
  const t0 = 20
  const marche = creerMarche({
    passants: HEURE_DE_POINTE.map((p) => {
      const v = VITESSE(p.marche) * p.vit
      return { x: p.x, z: positionZ(p, v, t0, defileA(t0)), sens: p.sens, vitesse: v }
    }),
    defile: defileA(t0),
    camera: { x: CAM_X, z: CAM_Z }
  })
  let t = t0
  return {
    marche,
    avancer(jusqua) {
      while (t < jusqua - 1e-9) {
        t += DT
        marche.avancer(DT, defileA(t))
      }
    }
  }
}

describe('la marche des passants', () => {
  it('AVANT : en files fixes, personne ne voit personne et les corps se traversent', () => {
    const avant = pire((t) =>
      HEURE_DE_POINTE.map((p) => ({ x: p.x, z: positionZ(p, VITESSE(p.marche) * p.vit, t, defileA(t)) }))
    )
    expect(avant.sous50).toBeGreaterThan(100)
    expect(avant.min).toBeLessThan(0.1)
  })

  it('MAINTENANT : aucun corps n entre dans un autre, à aucune image de 150 s', () => {
    const { marche, avancer } = foule()
    const apres = pire((t) => {
      avancer(t)
      return marche.marcheurs.map((m) => ({ x: m.x, z: marche.z(m) }))
    })
    expect(apres.sous50).toBe(0)
    expect(apres.min).toBeGreaterThan(MARCHE.ecartMin - 0.04)
  })

  it('chacun reste sur son trottoir, avance dans son sens, sans saut d une image à l autre', () => {
    const { marche, avancer } = foule()
    avancer(22)
    const depart = marche.marcheurs.map((m) => m.s)
    let avant = marche.marcheurs.map((m) => ({ x: m.x, s: m.s }))
    let horsTrottoir = 0
    let plusGrandPas = 0
    for (let t = 22; t < 22 + DUREE; t += DT) {
      avancer(t + DT)
      marche.marcheurs.forEach((m, i) => {
        const [x0, x1] = MARCHE.trottoirs[m.cote]
        if (m.x < x0 - 1e-9 || m.x > x1 + 1e-9) horsTrottoir++
        plusGrandPas = Math.max(plusGrandPas, Math.hypot(m.x - avant[i].x, m.s - avant[i].s))
      })
      avant = marche.marcheurs.map((m) => ({ x: m.x, s: m.s }))
    }
    expect(horsTrottoir).toBe(0)
    // À 60 images/s, le plus rapide fait 3 cm par image : rien ne saute.
    expect(plusGrandPas).toBeLessThan(0.06)
    // Personne n'est bloqué : chacun a parcouru au moins 70 % de ce qu'il aurait fait seul.
    marche.marcheurs.forEach((m, i) => {
      const parcouru = -m.sens * (m.s - depart[i])
      expect(parcouru, `passant ${i}`).toBeGreaterThan(0.7 * m.vPref * DUREE)
    })
  })

  it('DE FACE : on se voit de loin, chacun prend sa droite tôt, le buste pivote', () => {
    // Deux inconnus sur la même ligne du trottoir de droite, à 14 m l'un de l'autre, loin de la caméra.
    const m = creerMarche({
      passants: [
        { x: 5.7, z: -20, sens: 1, vitesse: 1.2 },
        { x: 5.7, z: -34, sens: -1, vitesse: 1.2 }
      ],
      defile: 0,
      camera: { x: CAM_X, z: CAM_Z }
    })
    const [a, b] = m.marcheurs
    let min = Infinity
    let ecartA4m = 0
    let busteMax = 0
    for (let k = 0; k < 60 * 12; k++) {
      m.avancer(DT, 0)
      const d = Math.hypot(a.x - b.x, a.s - b.s)
      min = Math.min(min, d)
      if (ecartA4m === 0 && Math.abs(a.s - b.s) < 4) ecartA4m = Math.abs(a.x - 5.7)
      busteMax = Math.max(busteMax, Math.abs(a.buste), Math.abs(b.buste))
    }
    // Le croisement se prépare avant d'être à 4 m.
    expect(ecartA4m).toBeGreaterThan(0.15)
    // Chacun a pris SA droite : celui qui s'éloigne (regarde vers -z) vers +x, l'autre vers -x.
    expect(a.x).toBeGreaterThan(5.7)
    expect(b.x).toBeLessThan(5.7)
    // Ils se croisent avec de l'air entre les épaules.
    expect(min).toBeGreaterThan(2 * MARCHE.rayon + 0.15)
    // L'épaule s'efface au croisement, sans dépasser la rotation prévue.
    expect(busteMax).toBeGreaterThan(0.1)
    expect(busteMax).toBeLessThanOrEqual(MARCHE.buste + 1e-9)
  })

  it('le décor fait marcher sa foule ainsi : cap, pas et buste viennent de la marche', () => {
    const source = readFileSync(new URL('./home-decor-foule.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/creerMarche\(/)
    expect(source).toMatch(/rotation\.y = m\.yaw/)
    expect(source).toMatch(/timeScale = g\.p\.vit \* Math\.min\(1\.4, m\.vitesse \/ g\.vitesse\)/)
    // Plus de file fixe affichée : la place vient de la marche, pas de l'heure seule.
    expect(source).not.toMatch(/racine\.position\.set\([^)]*positionZ/)
    expect(source).not.toMatch(/rotation\.y = g\.p\.sens === 1/)
  })

  it('un figurant immobile sur le chemin est contourné, jamais traversé', () => {
    const m = creerMarche({
      passants: [{ x: 5.5, z: -10, sens: 1, vitesse: 1.2 }],
      defile: 0,
      camera: { x: CAM_X, z: CAM_Z }
    })
    const [a] = m.marcheurs
    const figurant = { x: 5.5, z: -18, r: 0.27 }
    let min = Infinity
    for (let k = 0; k < 60 * 14; k++) {
      m.avancer(DT, 0, [figurant])
      min = Math.min(min, Math.hypot(a.x - figurant.x, enrouler(a.s) - figurant.z))
    }
    expect(min).toBeGreaterThanOrEqual(MARCHE.rayon + figurant.r + 0.08 - 1e-6)
    // Il est bien passé : il a dépassé le figurant.
    expect(enrouler(a.s)).toBeLessThan(figurant.z - 2)
  })
})
