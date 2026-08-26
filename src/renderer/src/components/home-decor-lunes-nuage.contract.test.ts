import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ECLAT_LUNES, MATIERE_NUAGE } from './home-decor-scene'

/**
 * Demande conv-1410 : « les lunes sont trop lumineuses et le nuage est moche ».
 *
 * « Lunes » = les corps annelés du décor (`planetes` de la composition) : ce qui brille sur eux
 * n'est pas leur surface mais leur HALO additif et leurs anneaux additifs — deux opacités en dur
 * dans les shaders (0,55 et 0,62), donc invérifiables et non réglables. « Nuage » = la nébuleuse :
 * son laideur venait d'un cœur blanchi (lerp 0,42 vers le blanc) posé sur un amas quasi isotrope,
 * qui se lit comme une boule de coton grisée plutôt que comme un filament.
 *
 * Rien de tout cela n'est capturable sans WebGL (happy-dom n'en a pas) : la preuve hors-modèle est
 * donc le RÉGLAGE relu, plus la vérification que le shader le CONSOMME au lieu d'un littéral.
 */
describe('éclat des lunes et matière du nuage', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')

  /**
   * Falsifieurs nommés — chaque entrée ferait échouer ce test si la correction était fausse :
   *  - `ECLAT_LUNES.halo = 0.55` (la valeur d'AVANT, laissée telle quelle) → assertion de baisse ;
   *  - `ECLAT_LUNES.halo = 0` (halo supprimé, la planète redevient un autocollant) → borne basse ;
   *  - constante ajoutée mais shader gardant `pow(rim, 3.2) * 0.55` → assertion de consommation.
   */
  it('baisse réellement le halo et les anneaux des lunes, sans les éteindre', () => {
    expect(ECLAT_LUNES.halo).toBeLessThan(0.55)
    expect(ECLAT_LUNES.halo).toBeGreaterThan(0.1)
    expect(ECLAT_LUNES.anneau).toBeLessThan(0.62)
    expect(ECLAT_LUNES.anneau).toBeGreaterThan(0.15)
    // Le limbe se resserre : plus la puissance est haute, plus la lueur reste collée au bord au
    // lieu de baigner tout le disque.
    expect(ECLAT_LUNES.limbe).toBeGreaterThanOrEqual(3.2)
  })

  it('fait CONSOMMER ces réglages par les shaders, littéral interdit', () => {
    // Le halo est monté depuis l'uniform, pas depuis un nombre écrit dans le fragment.
    expect(source).toMatch(/uOpaciteHalo:\s*\{\s*value:\s*ECLAT_LUNES\.halo\s*\}/)
    expect(source).toMatch(/uLimbe:\s*\{\s*value:\s*ECLAT_LUNES\.limbe\s*\}/)
    expect(source).not.toMatch(/pow\(rim, 3\.2\) \* 0\.55/)
    expect(source).toMatch(/uOpacite:\s*\{\s*value:\s*ECLAT_LUNES\.anneau\s*-/)
  })

  /**
   * Falsifieurs nommés pour le nuage :
   *  - `blancCoeur = 0.42` (le blanchiment d'avant) → assertion de baisse ;
   *  - `filaments = 1` (amas isotrope, la boule de coton revient) → borne de structure ;
   *  - `alpha = 0.5` (l'opacité d'avant, laiteuse sous le bloom) → borne d'alpha.
   */
  it('donne au nuage une matière filamenteuse au lieu du coton blanchi', () => {
    expect(MATIERE_NUAGE.blancCoeur).toBeLessThan(0.42)
    expect(MATIERE_NUAGE.filaments).toBeGreaterThanOrEqual(2)
    expect(MATIERE_NUAGE.alpha).toBeLessThan(0.5)
    expect(MATIERE_NUAGE.alpha).toBeGreaterThan(0.15)
    // Anisotropie : un nuage étiré est un filament, un nuage isotrope est une boule.
    expect(MATIERE_NUAGE.etirement.x).toBeGreaterThan(MATIERE_NUAGE.etirement.y * 1.2)
  })

  it('fait CONSOMMER ces réglages par la nébuleuse', () => {
    expect(source).toMatch(/MATIERE_NUAGE\.blancCoeur/)
    expect(source).toMatch(/MATIERE_NUAGE\.filaments/)
    expect(source).toMatch(/MATIERE_NUAGE\.etirement\.x/)
    expect(source).toMatch(/MATIERE_NUAGE\.alpha/)
    // L'alpha du fragment ne peut plus être le 0.5 en dur.
    expect(source).not.toMatch(/pow\(falloff, 1\.8\) \* 0\.5/)
  })
})
