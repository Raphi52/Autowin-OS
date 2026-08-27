import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ETOILES_PRINCIPALES } from './home-decor-scene'

/**
 * Demande conv-1410, 2026-08-27 : « rajoute quelques étoiles principales au loin ».
 *
 * Pas de WebGL en test (happy-dom) : la preuve est le RÉGLAGE relu + la vérification que
 * `buildStars` le CONSOMME (buffers dimensionnés sur le total, boucle dédiée) au lieu de laisser
 * la constante décorative.
 *
 * Falsifieurs nommés — chaque entrée ferait échouer ce test :
 *  - `nombre: 0` (constante ajoutée mais population vide) → borne basse ;
 *  - `nombre: 200` (« quelques » devenu un semis) → borne haute ;
 *  - `tailleMax <= 3.1` (indiscernables des étoiles franches existantes) → borne de taille ;
 *  - `eloignement: 0.3` (étoiles devant les planètes, plus « au loin ») → borne d'éloignement ;
 *  - buffers restés en `COUNT * 3` → les étoiles écrites hors zone allouée, assertion de source.
 */
describe('étoiles principales du fond d’écran', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')

  it('déclare une poignée d’étoiles franchement plus grosses et repoussées au loin', () => {
    expect(ETOILES_PRINCIPALES.nombre).toBeGreaterThanOrEqual(3)
    expect(ETOILES_PRINCIPALES.nombre).toBeLessThanOrEqual(12)
    // 3,1 = taille max d'une étoile « franche » de la population de fond (1,5 + 1,6).
    expect(ETOILES_PRINCIPALES.tailleMin).toBeGreaterThan(3.1)
    expect(ETOILES_PRINCIPALES.tailleMax).toBeGreaterThan(ETOILES_PRINCIPALES.tailleMin)
    // Bord externe de la coquille (rayons 42 → 88) : au-delà de 0,8 on est derrière tout le décor.
    expect(ETOILES_PRINCIPALES.eloignement).toBeGreaterThan(0.8)
    expect(ETOILES_PRINCIPALES.eloignement).toBeLessThanOrEqual(1)
  })

  it('alloue les buffers du champ d’étoiles pour ces étoiles en plus', () => {
    expect(source).toContain('const TOTAL = COUNT + ETOILES_PRINCIPALES.nombre')
    expect(source).toContain('new Float32Array(TOTAL * 3)')
    expect(source).toContain('new Float32Array(TOTAL)')
    expect(source).toMatch(/for \(let i = 0; i < ETOILES_PRINCIPALES\.nombre; i \+= 1\)/)
  })

  /**
   * Régression conv-1410 « je ne les vois pas » : le test ci-dessus borne `aSize` en ABSOLU, donc
   * 4,2-6,4 le passait alors que les étoiles rendaient ~2,7 px à l'écran. Ici on refait le calcul du
   * vertex shader (`aSize * uPixelRatio * (52 / -view.z)`) à la distance RÉELLE de pose.
   *
   * Falsifieur nommé : remettre `tailleMin: 4.2` / `tailleMax: 6.4` fait échouer CE test
   * (~2,6 px rendus < 8), là où l'ancien test restait vert.
   */
  it('rend les principales franchement plus grosses À L’ÉCRAN, à leur distance de pose', () => {
    const facteur = Number(
      /gl_PointSize = aSize \* uPixelRatio \* \(([\d.]+) \/ -view\.z\)/.exec(source)![1]
    )
    const distance = (42 + 46) * ETOILES_PRINCIPALES.eloignement
    const pixelsMin = (ETOILES_PRINCIPALES.tailleMin * facteur) / distance
    const pixelsMax = (ETOILES_PRINCIPALES.tailleMax * facteur) / distance
    // Une étoile « franche » de fond (aSize 3,1 posée à ~42) rend ~3,8 px : il faut le double au moins.
    expect(pixelsMin).toBeGreaterThanOrEqual(8)
    // Garde-fou haut : au-delà, ce sont des taches lumineuses, plus des étoiles.
    expect(pixelsMax).toBeLessThanOrEqual(20)
  })
})
