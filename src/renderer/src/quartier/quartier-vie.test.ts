import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import {
  avancerBateau,
  fonduVapeur,
  formeVolute,
  glissementEau,
  placeDuTram,
  type VoieBateau
} from './quartier-vie'

describe('les animations du décor (conv-1424, « les animations de décor sont éclatées »)', () => {
  it("l'eau ondule sans se découper en peigne : deux lignes voisines glissent presque pareil", () => {
    let pire = 0
    for (let temps = 0; temps < 20; temps += 0.13)
      for (let y = 341; y < 490; y++) {
        const a = glissementEau(y, temps, (y - 341) / 149)
        const b = glissementEau(y + 1, temps, (y + 1 - 341) / 149)
        pire = Math.max(pire, Math.abs(a - b))
      }
    // Avant : 0,46 rad par ligne et 3,6 px d'amplitude, soit jusqu'à 1,3 px d'une ligne à l'autre.
    expect(pire).toBeLessThan(0.25)
  })

  it("l'eau reste près de sa place, y compris sur la rive proche", () => {
    for (let temps = 0; temps < 20; temps += 0.13)
      expect(Math.abs(glissementEau(480, temps, 1))).toBeLessThan(1.1)
  })

  it('un bateau reste sur sa voie, vire et repart dans l’autre sens', () => {
    const b: VoieBateau = { x: 120, sens: 1, cap: 1, v: 5, min: 100, max: 140 }
    const vus = new Set<number>()
    let x = b.x
    for (let i = 0; i < 6000; i++) {
      avancerBateau(b, 1 / 30)
      x = b.x
      vus.add(Math.sign(b.cap))
      // Il finit son virage après le bout de la voie : quelques pixels, pas un demi-tour sur place.
      expect(x).toBeGreaterThan(b.min - 8)
      expect(x).toBeLessThan(b.max + 8)
    }
    expect(vus.has(1)).toBe(true)
    expect(vus.has(-1)).toBe(true)
  })

  it('un bateau vire sans à-coup : son cap change peu à chaque image', () => {
    const b: VoieBateau = { x: 139.9, sens: 1, cap: 1, v: 5, min: 100, max: 140 }
    let avant = b.cap
    for (let i = 0; i < 300; i++) {
      avancerBateau(b, 1 / 30)
      expect(Math.abs(b.cap - avant)).toBeLessThan(0.02)
      avant = b.cap
    }
  })

  it("le tram s'arrête aux deux bouts du pont et y repart en douceur", () => {
    expect(placeDuTram(0)).toBe(0)
    expect(placeDuTram(0.05)).toBe(0)
    expect(placeDuTram(0.5)).toBeCloseTo(0.5)
    expect(placeDuTram(0.97)).toBe(1)
    expect(placeDuTram(1.03)).toBe(1)
    expect(placeDuTram(1.5)).toBeCloseTo(0.5)
    let avant = placeDuTram(0)
    for (let t = 0; t < 2; t += 0.001) {
      const p = placeDuTram(t)
      expect(Math.abs(p - avant)).toBeLessThan(0.003)
      avant = p
    }
  })

  it('la vapeur est un ruban continu : deux hauteurs voisines ne se décalent presque pas', () => {
    for (let temps = 0; temps < 20; temps += 0.37)
      for (let u = 0; u < 0.98; u += 0.02) {
        const a = formeVolute(u, temps, 1.3, 26)
        const b = formeVolute(u + 0.02, temps, 1.3, 26)
        expect(Math.abs(a.dx - b.dx)).toBeLessThan(1.5)
        expect(Math.abs(a.l - b.l)).toBeLessThan(1)
      }
  })

  it('un filet de vapeur naît sans bord, reste fin, et se dissout tout à fait', () => {
    expect(fonduVapeur(0)).toBe(0)
    expect(fonduVapeur(1)).toBeCloseTo(0)
    expect(fonduVapeur(0.2)).toBe(1)
    let avant = 1
    for (let u = 0.28; u <= 1; u += 0.02) {
      expect(fonduVapeur(u)).toBeLessThanOrEqual(avant)
      avant = fonduVapeur(u)
    }
    // Au ras de l'eau, il est plus étroit qu'en haut : un panache, pas une colonne.
    expect(formeVolute(0, 0, 0, 20).l).toBeLessThan(formeVolute(1, 0, 0, 20).l)
  })

  it('la roue de Settings tourne autour de son centre, et son mât reste fixe', () => {
    const d = donnees as unknown as {
      vie: {
        calques: Record<
          string,
          { x: number; y: number; w: number; h: number; px: number; py: number }
        >
      }
      obj: { cle?: string; m: string; mh?: string }[]
    }
    const r = d.vie.calques.roue
    expect(r.w).toBe(r.h)
    expect(r.x + r.w / 2).toBe(r.px)
    expect(r.y + r.h / 2).toBe(r.py)
    // La roue reste cliquable alors que seul le mât est découpé dans la peinture.
    const o = d.obj.find((q) => q.cle === 'settings')
    expect(o?.mh).toMatch(/^data:image\/webp;base64,/)
    expect(o?.mh).not.toBe(o?.m)
  })

  it("l'onsen a pris la place de la machine, du tabouret et des baquets : aucune découpe ne les redessine (conv-1434)", () => {
    const d = donnees as unknown as {
      vie: { calques: Record<string, unknown> }
      obj: { n?: string }[]
    }
    // Une découpe restée dans les données repasse devant le tanuki qui marche derrière elle : une machine
    // fantôme au milieu de l'eau.
    const noms = d.obj.map((o) => o.n)
    for (const n of ['machine', 'bois', 'bain1_paroi', 'bain2_paroi', 'bain3_paroi'])
      expect(noms).not.toContain(n)
    expect(d.vie.calques.volant).toBeUndefined()
    expect(d.vie.calques.volantFixe).toBeUndefined()
  })

  it("l'eau animée couvre toute la surface, jusqu'au pied de la ville derrière le pont", () => {
    const { eau } = (
      donnees as unknown as { vie: { eau: { x: number; y: number; w: number; h: number } } }
    ).vie
    expect(eau.x).toBe(0)
    expect(eau.y).toBeLessThanOrEqual(332)
    expect(eau.x + eau.w).toBeGreaterThanOrEqual(790)
    expect(eau.y + eau.h).toBeGreaterThanOrEqual(480)
  })

  it('les objets qui bougent sont des peintures, et les fenêtres sont relevées sur la toile', () => {
    const { sprites, fenetres } = (
      donnees as unknown as {
        vie: {
          sprites: Record<string, { m: string; w: number; h: number }>
          fenetres: number[][]
        }
      }
    ).vie
    for (const nom of ['ballon', 'bateau1', 'bateau2', 'bateau3', 'tram']) {
      expect(sprites[nom].m).toMatch(/^data:image\/webp;base64,/)
      expect(sprites[nom].w).toBeGreaterThan(0)
    }
    expect(fenetres.length).toBeGreaterThan(20)
    for (const [x, y, w, h] of fenetres) {
      expect(x).toBeGreaterThanOrEqual(0)
      expect(y).toBeGreaterThan(150)
      // Plus bas, la rangée de maisons passe devant les tours : une lumière y tomberait sur un toit.
      expect(y + h).toBeLessThanOrEqual(294)
      // Une fenêtre reste une fenêtre : une grande plaque jaune se verrait comme un défaut.
      expect(w * h).toBeLessThan(30)
    }
  })
})
