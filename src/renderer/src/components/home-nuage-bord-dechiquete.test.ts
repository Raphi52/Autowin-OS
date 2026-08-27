import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  BORD_NUAGE,
  NUAGE_FRAGMENT_SHADER,
  SATURATION_NUAGE,
  profilBordNuage
} from './home-decor-scene'

/**
 * Demande conv-1455 : « le container du nuage est un cercle c moche, faut qu'il soit plus chaotique
 * et plus coloré », puis « bord encore plus déchiqueté + saturation des couleurs montée ».
 *
 * Le masque du nuage était `1.0 - smoothstep(0.10, 0.5, length(c))` : un disque PARFAIT, donc un
 * cercle visible dès que la matière est dense. happy-dom n'a pas de WebGL : la preuve est portée par
 * la FONCTION PURE du profil de bord (mêmes harmoniques que le shader) et par la consommation relue.
 */
describe('nuage — bord déchiqueté et saturation montée (conv-1455)', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')
  const angles = Array.from({ length: 720 }, (_, i) => (i * Math.PI * 2) / 720)
  const rayons = angles.map((a) => profilBordNuage(a))

  /**
   * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST si la correction est fausse :
   *  - `BORD_NUAGE.harmoniques = []` (profil constant → cercle parfait) → écart-type nul ;
   *  - `BORD_NUAGE.amplitude = 0.02` (bosse imperceptible, le cercle se lit encore) → borne de creux ;
   *  - harmoniques basses `[2, 3]` (ovale mou, pas déchiqueté) → borne du nombre d'extrema ;
   *  - `BORD_NUAGE.amplitude = 0.9` (le rayon passe sous 0 → masque troué) → borne de rayon min ;
   *  - `SATURATION_NUAGE.gain = 1` (aucune montée) → assertion de gain ;
   *  - shader gardant `smoothstep(0.10, 0.5, length(c))` en dur → assertion de consommation.
   */
  it('le profil de bord n EST PAS un cercle et reste un rayon valide', () => {
    const moyenne = rayons.reduce((s, r) => s + r, 0) / rayons.length
    const ecart = Math.sqrt(
      rayons.reduce((s, r) => s + (r - moyenne) ** 2, 0) / rayons.length
    )
    expect(ecart).toBeGreaterThan(0.06)
    expect(Math.min(...rayons)).toBeGreaterThan(0.25)
    expect(Math.max(...rayons)).toBeLessThan(1.6)
  })

  it('est DÉCHIQUETÉ : beaucoup de dents sur le tour, pas deux bosses', () => {
    let extrema = 0
    for (let i = 0; i < rayons.length; i++) {
      const prev = rayons[(i - 1 + rayons.length) % rayons.length]
      const suiv = rayons[(i + 1) % rayons.length]
      if ((rayons[i] > prev && rayons[i] > suiv) || (rayons[i] < prev && rayons[i] < suiv)) extrema++
    }
    expect(extrema).toBeGreaterThanOrEqual(24)
    expect(BORD_NUAGE.harmoniques.length).toBeGreaterThanOrEqual(4)
    expect(Math.max(...BORD_NUAGE.harmoniques)).toBeGreaterThanOrEqual(19)
  })

  it('monte la SATURATION sans brûler la couleur', () => {
    expect(SATURATION_NUAGE.gain).toBeGreaterThan(1.25)
    expect(SATURATION_NUAGE.gain).toBeLessThan(3)
  })

  it('fait CONSOMMER ces réglages par le shader, littéraux interdits', () => {
    expect(source).toMatch(/uSaturation:\s*\{\s*value:\s*SATURATION_NUAGE\.gain\s*\}/)
    expect(source).toMatch(/uBordAmplitude:\s*\{\s*value:\s*BORD_NUAGE\.amplitude\s*\}/)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/uSaturation/)
    expect(NUAGE_FRAGMENT_SHADER).toMatch(/uBordAmplitude/)
    // Le masque circulaire d'avant ne pilote plus le bord.
    expect(NUAGE_FRAGMENT_SHADER).not.toMatch(/smoothstep\(0\.10, 0\.5, length\(c\)\)/)
  })
})
