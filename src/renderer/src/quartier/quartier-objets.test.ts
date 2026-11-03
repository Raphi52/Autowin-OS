import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import { creerMarche, type DonneesMarche } from './quartier-marche'
import { TOUR_DU_WIDGET } from './quartier-tuiles'

// Les découpes de la Falaise o-1916 (conv-1460, plan conv-1444) : un objet qui passe devant un tanuki n'a de
// sens que si un tanuki peut se tenir derrière lui. Une découpe restée de l'ancienne peinture tombe sur du
// rocher ou dans le ciel de la nouvelle : elle ne cache plus personne, et repeint l'ancien décor par-dessus.
interface Objet {
  n?: string
  cle?: string
  nom?: string
  fixe?: string
  x: number
  y: number
  w: number
  h: number
  b?: number[]
}
const D = donnees as unknown as DonneesMarche & { obj: Objet[]; feuilles: Objet[] }
const marche = creerMarche(D)

/** Le pied de l'objet sous `px`, lu comme la scène le lit (`pied` de quartier-scene.ts). */
function pied(o: Objet, px: number): number {
  const b = o.b ?? []
  const t = Math.max(0, Math.min(b.length - 1, (px - o.x) / 8))
  const a = Math.floor(t)
  const e = Math.min(b.length - 1, a + 1)
  return b[a] + (b[e] - b[a]) * (t - a)
}

/** Les places de la carte de marche où un tanuki serait derrière l'objet, en le chevauchant. */
function placesDerriere(o: Objet): number {
  const G = D.g
  let n = 0
  for (let X = G.x0; X < G.x0 + G.w * G.pas; X += G.pas) {
    if (X < o.x - 12 || X > o.x + o.w + 12) continue
    for (let Y = G.y0; Y < G.y0 + G.h * G.pas; Y += G.pas)
      if (marche.libre(X, Y) && Y < pied(o, X) - 1 && Y + 4 > o.y && Y - 45 < o.y + o.h) n++
  }
  return n
}

describe('les objets découpés dans la Falaise o-1916 (conv-1460)', () => {
  const devant = D.obj.filter((o) => o.n && o.fixe !== 'ciel')

  it('chaque objet qui passe devant les tanukis a du sol marchable derrière lui', () => {
    expect(devant.length).toBeGreaterThan(15)
    for (const o of devant) expect(placesDerriere(o), o.n).toBeGreaterThan(0)
  })

  it('un objet du ciel ne passe jamais devant un tanuki : il n’a pas besoin de sol', () => {
    const ciel = D.obj.filter((o) => o.fixe === 'ciel')
    expect(ciel.length).toBeGreaterThanOrEqual(10)
    for (const o of ciel) expect(o.cle, o.nom).toBeTruthy()
  })

  it('la ligne de pied reste dans la boîte de l’objet, une valeur tous les 8 px', () => {
    for (const o of [...D.obj, ...D.feuilles]) {
      const b = o.b ?? []
      expect(b.length, o.n ?? o.cle).toBe(Math.floor((o.w + 7) / 8) + 1)
      for (const v of b) {
        expect(v, o.n ?? o.cle).toBeGreaterThanOrEqual(o.y)
        expect(v, o.n ?? o.cle).toBeLessThanOrEqual(o.y + o.h)
      }
    }
  })

  it('chaque tuile de l’Accueil garde sa tour cliquable dans la ville', () => {
    for (const cle of Object.values(TOUR_DU_WIDGET)) {
      const o = D.obj.find((q) => q.cle === cle)
      expect(o?.nom, cle).toBeTruthy()
      expect(o?.fixe, cle).toBe('ciel')
    }
  })
})
