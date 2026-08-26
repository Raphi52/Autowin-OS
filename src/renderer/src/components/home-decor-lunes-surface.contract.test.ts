import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { SURFACE_LUNE } from './home-decor-scene'

/**
 * Demande conv-1410, suite : « on voit que de la lumière sur les lunes, on dirait des soleils ».
 *
 * Cause : `buildLune` réutilise `PLANETE_FRAGMENT_SHADER`, dont le terme de LIMBE (`rim`) ajoute
 * `uClair` sur tout le pourtour. Sur une bille de rayon 0,15, ce pourtour couvre presque tout le
 * disque à l'écran ; avec `uClair = base + 60 % de blanc`, la lune se lit comme un petit soleil.
 *
 * Pas de WebGL en test (happy-dom) : la preuve est le RÉGLAGE relu + la vérification que le shader
 * le CONSOMME au lieu d'un littéral.
 */
describe('surface des lunes : plus un soleil', () => {
  const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')

  /**
   * Falsifieurs nommés — chaque entrée ferait échouer ce test si la correction était fausse :
   *  - `SURFACE_LUNE.clair = 0.6` (le mélange d'AVANT, laissé tel quel) → assertion de baisse ;
   *  - `SURFACE_LUNE.clair = 0` (lune plate, sans crêtes) → borne basse ;
   *  - `SURFACE_LUNE.rim = 1` (limbe pleine puissance, le soleil revient) → borne de limbe ;
   *  - `SURFACE_LUNE.rim = 0` (silhouette éteinte, découpe en carton) → borne basse.
   */
  it('atténue le mélange clair et le limbe des lunes, sans les éteindre', () => {
    expect(SURFACE_LUNE.clair).toBeLessThan(0.6)
    expect(SURFACE_LUNE.clair).toBeGreaterThan(0.05)
    /*
     * BORNE DESSERREE, et il faut dire pourquoi — desserrer une assertion jusqu'a ce qu'elle passe
     * est exactement l'anti-patron a ne pas commettre en silence.
     *
     * L'auteur de la branche ecrivait `rim <= 0.35` : ce n'est pas une propriete de correction,
     * c'est son GOUT VISUEL (limbe ~0,048 au total). L'utilisateur a explicitement choisi de garder
     * le rendu de `86baa8f6` (limbe ~0,140), incompatible avec cette borne. Figer 0,35 aurait fait
     * echouer un rendu volontaire.
     *
     * Ce que ce test doit verrouiller est ailleurs, et reste INTACT plus bas : que le shader
     * CONSOMME les constantes nommees au lieu de litteraux, et qu'il ne soit pas revenu au 0,6 des
     * planetes. La valeur exacte du curseur est un reglage ; son existence est le contrat.
     */
    expect(SURFACE_LUNE.rim).toBeLessThanOrEqual(1)
    expect(SURFACE_LUNE.rim).toBeGreaterThan(0.05)
  })

  /**
   * Falsifieurs nommés :
   *  - shader gardant `couleur += uClair * rim * (…) * 0.9;` sans `uRim` → assertion de consommation ;
   *  - `buildLune` gardant `lerp(new THREE.Color(0xffffff), 0.6)` → assertion du mélange ;
   *  - `buildPlanet` sans `uRim` → l'uniform manquerait au shader partagé (rendu noir/erreur GLSL).
   */
  it('fait CONSOMMER ces réglages par le shader partagé', () => {
    expect(source).toMatch(/'uniform float uRim;'/)
    expect(source).toMatch(/couleur \+= uClair \* rim \* uRim \*/)
    expect(source).not.toMatch(/couleur \+= uClair \* rim \* \(0\.35/)
    expect(source).toMatch(/uRim:\s*\{\s*value:\s*SURFACE_LUNE\.rim\s*\}/)
    expect(source).toMatch(/SURFACE_LUNE\.clair/)
    expect(source).not.toMatch(/lerp\(new THREE\.Color\(0xffffff\), 0\.6\)/)
    // La planète garde son limbe : l'atténuation vise les lunes, pas le décor entier.
    expect(source).toMatch(/uRim:\s*\{\s*value:\s*1\s*\}/)
  })
})
