import { describe, expect, it } from 'vitest'
import {
  COMPOSITIONS,
  createDecorScene,
  DECOR_DEFAUT,
  DECOR_VARIANTS,
  NAPPE_FRAGMENT_SHADER
} from './home-decor-scene'

/**
 * Le catalogue des directions du décor.
 *
 * La scène elle-même n'est pas testable ici : happy-dom n'a pas de WebGL, et c'est voulu — un décor
 * n'est pas une dépendance de la fonction, son absence doit laisser la page s'afficher. Ce qui EST
 * testable, et ce qui casserait silencieusement, c'est le contrat autour : le catalogue, le défaut, et
 * le fait qu'une valeur inconnue ne fasse pas tomber la vue.
 */
describe('directions du decor', () => {
  it('expose les cinq directions, chacune avec un nom et un resume', () => {
    expect(DECOR_VARIANTS.map((v) => v.id)).toEqual([
      'actuel',
      'limbe',
      'poussiere',
      'orbites',
      'nappe'
    ])
    for (const variante of DECOR_VARIANTS) {
      expect(variante.nom.length).toBeGreaterThan(2)
      // Le resume sert a CHOISIR : une entree sans description ne serait qu'un identifiant.
      expect(variante.resume.length).toBeGreaterThan(20)
    }
  })

  it('a « poussiere » pour defaut — la direction choisie par l utilisateur sur rendus compares', () => {
    expect(DECOR_DEFAUT).toBe('poussiere')
    expect(DECOR_VARIANTS.some((v) => v.id === DECOR_DEFAUT)).toBe(true)
  })

  /**
   * La direction par defaut n'est pas qu'un identifiant : elle PROMET une image. Ces assertions
   * portent sur la composition reellement montee, pas sur le libelle — c'est ce qui casserait si
   * quelqu'un remettait une silhouette ou aplatissait la parallaxe en gardant le nom.
   */
  it('tient la promesse de « poussiere » : aucune silhouette, six plans, forte parallaxe', () => {
    const poussiere = COMPOSITIONS[DECOR_DEFAUT]
    // Aucune silhouette : ni planete, ni satellite — que de la matiere.
    expect(poussiere.planetes).toHaveLength(0)
    expect(poussiere.satellites).toBe(0)
    // Six plans de profondeur DISTINCTS : c'est la profondeur etagee qui fait le relief.
    expect(poussiere.nebuleuses).toHaveLength(6)
    expect(new Set(poussiere.nebuleuses.map((n) => n.z)).size).toBe(6)
    // Forte parallaxe : strictement au-dessus des autres directions, sinon « forte » ne veut rien dire.
    for (const autre of DECOR_VARIANTS.filter((v) => v.id !== DECOR_DEFAUT)) {
      expect(poussiere.parallaxe).toBeGreaterThan(COMPOSITIONS[autre.id].parallaxe)
    }
    // Le resume affiche a l'utilisateur doit decrire CETTE image.
    const entree = DECOR_VARIANTS.find((v) => v.id === DECOR_DEFAUT)
    expect(entree?.resume).toMatch(/aucune silhouette/)
  })

  /**
   * La promesse de « nappe » : une NAPPE de bruit organique, or sur anthracite, TRES LENTE.
   *
   * Ces assertions portent sur la composition et sur le shader reellement monte, pas sur le
   * libelle. Entrees qui feraient echouer ce test si la correction etait fausse :
   *   - `tempo: 1` (ou toute valeur >= au tempo d'une autre direction) → « tres lente » ne tiendrait plus ;
   *   - une nappe coloree en ROSE/CYAN comme le reste du decor → l'assertion or/anthracite tombe ;
   *   - une nappe posee sans bruit fractal (un simple `mix()` de gradient) → l'assertion fbm tombe ;
   *   - une planete ou un arc laisse dans la composition → l'assertion « aucune silhouette » tombe.
   */
  it('tient la promesse de « nappe » : bruit fractal or/anthracite, aucune silhouette, la plus lente', () => {
    const nappe = COMPOSITIONS.nappe
    // Une nappe, rien d'autre : pas de silhouette, pas de ligne, pas de satellite.
    expect(nappe.planetes).toHaveLength(0)
    expect(nappe.arcs).toBe(0)
    expect(nappe.satellites).toBe(0)
    // La nappe existe et porte le duo or/anthracite — pas la palette rose/cyan du reste du decor.
    expect(nappe.nappe).toBeDefined()
    expect(nappe.nappe?.or).toBe(0xe9bd4e)
    expect(nappe.nappe?.anthracite).toBe(0x1b222c)
    // « Tres lente » : STRICTEMENT plus lente que toutes les autres directions.
    for (const autre of DECOR_VARIANTS.filter((v) => v.id !== 'nappe')) {
      expect(nappe.tempo).toBeLessThan(COMPOSITIONS[autre.id].tempo)
    }
    // Bruit ORGANIQUE : somme d'octaves, pas un degrade lineaire.
    expect(NAPPE_FRAGMENT_SHADER).toMatch(/fbm/)
    expect(NAPPE_FRAGMENT_SHADER.match(/octave|for \(/)).toBeTruthy()
    expect(NAPPE_FRAGMENT_SHADER).toMatch(/uOr/)
    expect(NAPPE_FRAGMENT_SHADER).toMatch(/uAnthracite/)
    // Le resume affiche a l'utilisateur doit decrire CETTE image.
    expect(DECOR_VARIANTS.find((v) => v.id === 'nappe')?.resume).toMatch(/or/)
  })

  it('rend null sans WebGL plutot que de jeter', () => {
    // C'est ce qui garantit que la page d'accueil s'affiche sur une machine sans pilote 3D.
    expect(createDecorScene()).toBeNull()
    expect(createDecorScene('limbe')).toBeNull()
  })
})
