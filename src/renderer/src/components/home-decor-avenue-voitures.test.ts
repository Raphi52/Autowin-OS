import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { ATLANTIC, caisseAtlantic } from './home-decor-avenue-atlantic'
import { carrosserie, FILES, FORMES, GAREE, type Forme } from './home-decor-avenue-voitures'

/*
 * LES VOITURES DE L'AVENUE (conv-320) : « refais les voitures du fond d'écran de l'accueil pour
 * qu'elles soient toutes différentes et mets en une garée avec un style futuriste top qualité ».
 *
 * Ce que ces tests tiennent, sans carte graphique :
 *   1. aucune carrosserie n'est la copie d'une autre (l'ancien défaut : deux caisses du même profil) ;
 *      depuis conv-330, la garée est l'« Atlantic volante » (home-decor-avenue-atlantic.ts) ;
 *   2. chaque caisse est une surface fermée tournée vers l'extérieur (sinon elle s'affiche à l'envers) ;
 *   3. la voiture garée n'est sur le chemin d'aucune file, et ses roues restent avant la bordure ;
 *   4. aucune lumière ajoutée (chaque programme de la rue serait recompilé), et le branchement dans
 *      l'avenue : monté avant la compilation de la rue, animé à chaque image, libéré à la fin.
 */

const source = readFileSync(new URL('./home-decor-avenue-voitures.ts', import.meta.url), 'utf8')
const sourceAtlantic = readFileSync(new URL('./home-decor-avenue-atlantic.ts', import.meta.url), 'utf8')
const avenue = readFileSync(new URL('./home-decor-avenue.ts', import.meta.url), 'utf8')
const demiLargeur = (f: Forme): number => Math.max(...f.cles.map((c) => c[1]))

describe('les voitures de l avenue (conv-320)', () => {
  it('quatre carrosseries qui roulent et une garée, toutes différentes', () => {
    const formes = [...Object.values(FORMES), ATLANTIC]
    expect(formes).toHaveLength(5)
    const signatures = new Set(formes.map((f) => JSON.stringify(f.cles)))
    expect(signatures.size).toBe(5)
    // pas seulement des chiffres différents : des longueurs et des hauteurs franchement distinctes
    const gabarits = formes.map((f) => {
      const zs = f.cles.map((c) => c[0])
      const longueur = Math.max(...zs) - Math.min(...zs)
      const hauteur = Math.max(...f.cles.map((c) => c[4]))
      return `${longueur.toFixed(1)}x${hauteur.toFixed(1)}`
    })
    expect(new Set(gabarits).size).toBe(5)
  })

  it.each(Object.entries(FORMES))(
    'la caisse « %s » est fermée et tournée vers l extérieur',
    (_nom, f) => {
      const { geo } = carrosserie(f)
      const pos = geo.getAttribute('position')
      const nor = geo.getAttribute('normal')
      const p = new THREE.Vector3()
      const n = new THREE.Vector3()
      const centre = new THREE.Vector3()
      let dehors = 0
      for (let i = 0; i < pos.count; i++) {
        p.fromBufferAttribute(pos, i)
        n.fromBufferAttribute(nor, i)
        // l'axe de la caisse, à la hauteur médiane de sa section
        centre.set(0, p.y, p.z)
        const yMilieu = f.cles.reduce((s, c) => s + (c[2] + c[4]) / 2, 0) / f.cles.length
        centre.y = yMilieu
        if (n.dot(p.clone().sub(centre)) > 0) dehors++
      }
      expect(dehors / pos.count).toBeGreaterThan(0.95)
      // trois matières : tôle, vitre, bas de caisse — et une vraie vitre sur chacune
      expect(geo.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2])
      expect(geo.groups[1].count).toBeGreaterThan(0)
    }
  )

  it('la voiture garée (Atlantic volante) est une caisse fermée, tournée vers l extérieur', () => {
    const { geo } = caisseAtlantic(ATLANTIC)
    const pos = geo.getAttribute('position')
    const nor = geo.getAttribute('normal')
    const p = new THREE.Vector3()
    const n = new THREE.Vector3()
    const yMilieu = ATLANTIC.cles.reduce((s, c) => s + (c[2] + c[4]) / 2, 0) / ATLANTIC.cles.length
    let dehors = 0
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i)
      n.fromBufferAttribute(nor, i)
      if (n.dot(p.clone().sub(new THREE.Vector3(0, yMilieu, p.z))) > 0) dehors++
    }
    expect(dehors / pos.count).toBeGreaterThan(0.95)
    expect(geo.groups.map((g) => g.materialIndex)).toEqual([0, 1, 2])
    expect(geo.groups[1].count).toBeGreaterThan(0)
  })

  it('la voiture garée tient dans sa place : sur le chemin d aucune file', () => {
    // la largeur RÉELLE de la caisse, ailes gonflées comprises
    const { geo } = caisseAtlantic(ATLANTIC)
    geo.computeBoundingBox()
    const boite = geo.boundingBox!
    expect(Math.max(-boite.min.x, boite.max.x)).toBeLessThanOrEqual(GAREE.demiLargeur)
    const garee = { de: GAREE.x - GAREE.demiLargeur, a: GAREE.x + GAREE.demiLargeur }
    for (const [nom, file] of Object.entries(FILES)) {
      const w = demiLargeur(FORMES[nom as keyof typeof FILES])
      const de = file.x - w
      const a = file.x + w
      const chevauche = de < garee.a && a > garee.de
      expect(chevauche, nom).toBe(false)
    }
  })

  it('aucune lumière ajoutée, aucun fichier chargé', () => {
    expect(source).not.toMatch(/Light\s*\(/)
    expect(source).not.toMatch(/\bfetch\s*\(|\.src\s*=|import\.meta\.glob/)
    expect(sourceAtlantic).not.toMatch(/Light\s*\(/)
    expect(sourceAtlantic).not.toMatch(/\bfetch\s*\(|\.src\s*=|import\.meta\.glob/)
  })

  it('branchée dans l avenue : montée avant la compilation, animée, libérée', () => {
    expect(avenue).toMatch(
      /import \{ GAREE, monterVoitures \} from '\.\/home-decor-avenue-voitures'/
    )
    expect(avenue.indexOf('monterVoitures(')).toBeGreaterThan(0)
    expect(avenue.indexOf('monterVoitures(')).toBeLessThan(avenue.indexOf('compilerEnFond(scene)'))
    expect(avenue).toMatch(
      /flotte\.animer\(t, v, p\.voitures, zVisible\(GAREE\.zp\), camera\.position\.z\)/
    )
    expect(avenue).toMatch(/flotte\.liberer\(\)/)
    // l'ancienne caisse extrudée, partagée par deux voitures, n'existe plus
    expect(avenue).not.toMatch(/ExtrudeGeometry\(profil/)
  })
})
