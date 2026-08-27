import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  ETOILE_NUAGE,
  NUAGE_COSMIQUE,
  NUAGE_FRAGMENT_SHADER,
  NUAGE_DYNAMIQUE,
  positionNuage
} from './home-decor-scene'

/**
 * Demande conv-1449, image jointe : « le nuage dans l'accueil je veux qu'il ressemble a ça et qu'il
 * soit plus dynamique ».
 *
 * L'image est une NÉBULEUSE COSMIQUE MULTICOLORE : braises orange/or à gauche, magenta, turquoise à
 * droite, et une ÉTOILE BLANCHE À BRANCHES au centre. Le nuage existant est bleu-violet, sans étoile,
 * et sa matière dérive à 0,017 unité/s — quasi immobile à l'œil.
 *
 * Le nuage doit RESTER bleu-violet dans ses deux teintes de base (contrat conv-1408, testé ailleurs) :
 * ce test ajoute les teintes CHAUDES et l'étoile, il ne les remplace pas.
 *
 * happy-dom n'a pas de WebGL : la preuve est portée par les RÉGLAGES exportés, les FONCTIONS PURES et
 * la CONSOMMATION relue du shader.
 */
describe('nuage central — nébuleuse multicolore avec étoile, plus dynamique (conv-1449)', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')

  /**
   * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST si la correction est fausse :
   *  - `chaud: 0x3f7bff` (une 5ᵉ teinte bleue au lieu des braises) → assertion rouge dominant ;
   *  - `chaud` déclaré mais shader gardant `vec3(0.42, 0.18, 0.55)` en dur → assertion de consommation ;
   *  - `ETOILE_NUAGE.eclat = 0` (étoile éteinte) → borne basse ;
   *  - `branches = 2` (une croix, pas une étoile) → borne de branches ;
   *  - `NUAGE_DYNAMIQUE.vitesseMatiere = 0.017` (la valeur d'avant) → assertion d'accélération ;
   *  - `positionNuage` inchangée → assertion de course parcourue.
   */
  it('porte des BRAISES chaudes en plus du bleu-violet', () => {
    const rouge = (h: number): number => (h >> 16) & 0xff
    const bleu = (h: number): number => h & 0xff
    expect(rouge(NUAGE_COSMIQUE.chaud)).toBeGreaterThan(bleu(NUAGE_COSMIQUE.chaud))
    expect(rouge(NUAGE_COSMIQUE.chaud)).toBeGreaterThan(150)
    // Le froid turquoise reste : l'image oppose braise et turquoise, elle ne choisit pas.
    expect(bleu(NUAGE_COSMIQUE.froid)).toBeGreaterThan(rouge(NUAGE_COSMIQUE.froid))
  })

  it('porte une ÉTOILE à branches au cœur, réglée et non éteinte', () => {
    expect(ETOILE_NUAGE.eclat).toBeGreaterThan(0.3)
    expect(ETOILE_NUAGE.branches).toBeGreaterThanOrEqual(4)
    // Le halo de l'étoile reste petit devant le nuage, sinon il blanchit tout le centre.
    expect(ETOILE_NUAGE.rayon).toBeLessThan(0.2)
    expect(ETOILE_NUAGE.rayon).toBeGreaterThan(0.005)
    // Elle SCINTILLE : sans pulsation, c'est un point collé.
    expect(ETOILE_NUAGE.pulsation).toBeGreaterThan(0)
  })

  it('EST PLUS DYNAMIQUE : la matière avance plus vite qu avant', () => {
    expect(NUAGE_DYNAMIQUE.vitesseMatiere).toBeGreaterThan(0.017)
    expect(NUAGE_DYNAMIQUE.vitesseWarp).toBeGreaterThan(0)
    // Le nuage RESPIRE : densité modulée dans le temps.
    expect(NUAGE_DYNAMIQUE.respiration).toBeGreaterThan(0)
    expect(NUAGE_DYNAMIQUE.respiration).toBeLessThan(0.5)
  })

  it('DÉRIVE PLUS VIVE : la course parcourue en 60 s a augmenté', () => {
    const cadre = { halfWidth: 20, halfHeight: 12 }
    let course = 0
    let precedent = positionNuage(0, cadre)
    for (let t = 0.5; t <= 60; t += 0.5) {
      const p = positionNuage(t, cadre)
      course += Math.hypot(p.x - precedent.x, p.y - precedent.y)
      precedent = p
    }
    // Mesuré sur l'ancien réglage (amplitude 0,22 / vX 0,037 / vY 0,029) : ~4,6 unités.
    expect(course).toBeGreaterThan(7)
    // Sans quitter le milieu : le contrat conv-1408 tient.
    expect(NUAGE_COSMIQUE.derive.amplitude).toBeLessThan(0.5)
  })

  it('fait CONSOMMER ces réglages par le shader, littéraux interdits', () => {
    expect(source).toMatch(/uChaud:\s*\{\s*value:\s*new THREE\.Color\(NUAGE_COSMIQUE\.chaud\)\s*\}/)
    expect(source).toMatch(/uEtoile:\s*\{\s*value:\s*ETOILE_NUAGE\.eclat\s*\}/)
    expect(source).toMatch(/uEtoileRayon:\s*\{\s*value:\s*ETOILE_NUAGE\.rayon\s*\}/)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/uChaud/)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/uEtoile/)
    // Les branches de l'étoile : un motif angulaire, pas un simple point radial.
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/uBranches/)
    // L'ancienne dérive en dur ne pilote plus la matière.
    expect(NUAGE_FRAGMENT_SHADER).not.toMatch(/uTime \* 0\.017/)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/uVitesse/)
    expect(source).not.toMatch(/vec3\(0\.42, 0\.18, 0\.55\)/)
  })
})
