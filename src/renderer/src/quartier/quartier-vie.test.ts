import { describe, expect, it } from 'vitest'
import donnees from '../assets/quartier/donnees.json'
import {
  ANNEAU,
  avancerBateau,
  fonduVapeur,
  formeVolute,
  glissementEau,
  PHARE,
  placeDuTram,
  VAPEURS_ONSEN,
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
    // La roue est peinte dans la Falaise o-1916 (conv-1444) : un fond fixe cache ses rayons peints, et le
    // moyeu, fixe lui aussi, reste sur l'axe de la jante qui tourne.
    const fond = d.vie.calques.roueFond
    expect([fond.x, fond.y, fond.w, fond.h]).toEqual([r.x, r.y, r.w, r.h])
    const moyeu = d.vie.calques.roueMoyeu
    expect(Math.hypot(moyeu.x + moyeu.w / 2 - r.px, moyeu.y + moyeu.h / 2 - r.py)).toBeLessThan(4)
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

  it('le dojo est peint dans la Falaise : ni lui, ni ses coussins, son encens ou ses mannequins ne sont recollés (conv-1459)', () => {
    const d = donnees as unknown as {
      vie: { calques: Record<string, unknown> }
      obj: { n?: string }[]
    }
    // Une découpe de l'ancienne peinture restée dans les données se redessine par-dessus la nouvelle : un second
    // dojo, et des mannequins plantés dans le rocher sous la véranda.
    const colles = ['dojo', 'dojoDevant', 'dojoEscalier', 'encens', 'mannequin1', 'mannequin2']
    for (let i = 1; i <= 6; i++) colles.push(`coussin${i}`)
    const noms = d.obj.map((o) => o.n)
    for (const n of colles) {
      expect(d.vie.calques[n], n).toBeUndefined()
      expect(noms).not.toContain(n)
    }
  })

  it("la vapeur de l'onsen monte de son eau, entre ses baigneurs (conv-1459)", () => {
    const bains = (
      donnees as unknown as { postes: { me: string; x: number; cl?: number }[] }
    ).postes.filter((p) => p.me === 'bain')
    const gauche = Math.min(...bains.map((p) => p.x))
    const droite = Math.max(...bains.map((p) => p.x))
    // La ligne d'eau la plus haute : celle des baigneurs adossés aux galets du fond.
    const eau = Math.min(...bains.map((p) => p.cl as number))
    expect(VAPEURS_ONSEN.length).toBeGreaterThanOrEqual(5)
    for (const v of VAPEURS_ONSEN) {
      expect(v.x, `${v.x},${v.y}`).toBeGreaterThan(gauche)
      expect(v.x, `${v.x},${v.y}`).toBeLessThan(droite)
      // Le filet naît dans l'eau, sous les galets du fond, pas sur eux ni sur le sable.
      expect(v.y - eau, `${v.x},${v.y}`).toBeGreaterThan(15)
    }
  })

  it("l'eau animée couvre toute la rivière, du quai de la ville jusqu'au pied du hangar", () => {
    const { eau } = (
      donnees as unknown as { vie: { eau: { x: number; y: number; w: number; h: number } } }
    ).vie
    // L'eau de la Falaise o-1916, relevée sur la peinture (conv-1444) : du bord gauche jusque derrière
    // l'atelier (x 688), du quai au fond (y 340) jusqu'au plancher du hangar (y 528).
    // fix-ok: les bornes d'avant (y ≤ 332, x + w ≥ 790) étaient la mer de l'ancienne peinture ; sur la
    // Falaise o-1916 l'eau mesurée va de x 1 à 687,5 et de y 340 à 528,5 (lot 4, eau2.py).
    expect(eau.x).toBe(0)
    expect(eau.y).toBeLessThanOrEqual(340)
    expect(eau.x + eau.w).toBeGreaterThanOrEqual(688)
    expect(eau.y + eau.h).toBeGreaterThanOrEqual(528)
  })

  it("la cloche remplace le gong : rien de l'ancienne peinture n'est redessiné par-dessus (conv-1444)", () => {
    const d = donnees as unknown as {
      vie: { calques: Record<string, unknown>; gong: { disque: [number, number, number] } }
      obj: { n?: string; cle?: string; x: number; y: number; w: number; h: number }[]
    }
    // Restés dans les données, le maillet et l'ombre du gong se peignaient sur le rocher de la Falaise o-1916.
    for (const n of ['maillet', 'gongOmbre', 'gong', 'longuevue'])
      expect(d.vie.calques[n], n).toBeUndefined()
    expect(d.obj.map((o) => o.n)).not.toContain('gong')
    // La lueur et les ondes du coup partent de la cloche, dans la zone qui ouvre Task Manager.
    const [cx, cy, r] = d.vie.gong.disque
    const cloche = d.obj.find((o) => o.cle === 'task')!
    expect(cx - r).toBeGreaterThanOrEqual(cloche.x)
    expect(cx + r).toBeLessThanOrEqual(cloche.x + cloche.w)
    expect(cy - r).toBeGreaterThanOrEqual(cloche.y)
    expect(cy + r).toBeLessThanOrEqual(cloche.y + cloche.h)
  })

  it('les lueurs du ciel tombent sur leurs objets : étoiles dans le Brain, anneau et phare sur leur tour', () => {
    const d = donnees as unknown as {
      vie: { etoiles: [number, number, number][] }
      obj: { cle?: string; x: number; y: number; w: number; h: number }[]
    }
    const boite = (cle: string): { x: number; y: number; w: number; h: number } =>
      d.obj.find((o) => o.cle === cle)!
    const brain = boite('knowledge')
    expect(d.vie.etoiles.length).toBeGreaterThanOrEqual(8)
    for (const [x, y] of d.vie.etoiles) {
      expect(x, `${x},${y}`).toBeGreaterThan(brain.x)
      expect(x, `${x},${y}`).toBeLessThan(brain.x + brain.w)
      expect(y, `${x},${y}`).toBeGreaterThan(brain.y)
      expect(y, `${x},${y}`).toBeLessThan(brain.y + brain.h)
    }
    // Au milieu de leur tour, pas seulement dans sa boîte : la lueur d'à côté se voyait sur le ciel.
    for (const [cle, [x, y]] of [
      ['t_anneau', ANNEAU],
      ['t_phare', PHARE]
    ] as const) {
      const t = boite(cle)
      expect(Math.abs(x - (t.x + t.w / 2)), cle).toBeLessThan(t.w / 4)
      expect(y, cle).toBeGreaterThan(t.y)
      expect(y, cle).toBeLessThan(t.y + t.h / 3)
    }
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

  it('les fenêtres qui s’allument sont celles des cinq tours de la Falaise o-1916 (conv-1444)', () => {
    const d = donnees as unknown as {
      vie: { fenetres: [number, number, number, number][] }
      obj: { cle?: string; x: number; y: number; w: number; h: number }[]
    }
    // Les fenêtres relevées sur l'ancienne peinture passaient le test d'au-dessus : 29 sur 72 tombaient hors
    // des tours de la nouvelle, et s'allumaient là où elle ne peint aucune fenêtre (lot 4, conv-1461).
    const tours = ['t_bulle', 't_enveloppe', 't_horloge', 't_anneau', 't_phare'].map((cle) => {
      const t = d.obj.find((o) => o.cle === cle)
      expect(t, cle).toBeDefined()
      return { cle, ...t! }
    })
    const tourDe = (x: number, y: number, w: number, h: number): string | undefined =>
      tours.find(
        (t) => x + w / 2 > t.x && x + w / 2 < t.x + t.w && y + h / 2 > t.y && y + h / 2 < t.y + t.h
      )?.cle
    const allumees = new Set<string>()
    for (const [x, y, w, h] of d.vie.fenetres) {
      const cle = tourDe(x, y, w, h)
      expect(cle, `fenêtre ${x},${y} hors des tours`).toBeDefined()
      allumees.add(cle!)
    }
    // Chaque tour a les siennes : une liste décalée d'un bloc finirait toute sur une ou deux tours.
    expect([...allumees].sort()).toEqual(tours.map((t) => t.cle).sort())
  })
})
