import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  COMPOSITIONS,
  createDecorScene,
  DECOR_DEFAUT,
  DECOR_VARIANTS,
  estDirectionDecor,
  FOND_DECOR,
  NAPPE_FRAGMENT_SHADER
} from './home-decor-scene'

/** Les directions COMPOSEES par `home-decor-scene.ts`, toutes comparables sur `parallaxe` et `tempo`. */
const SPATIALES = DECOR_VARIANTS.map((v) => v.id)

/**
 * Le decor 3D est le FOND de l'accueil, pas une surcouche posee sur l'image plate.
 *
 * Constat utilisateur : « je vois toujours le fond d'ecran qui est present dans toutes les
 * vues dans la vue accueil […] je veux une reproduction en 3d ». Le canevas s'effacait en alpha 0
 * (`setClearColor(0x000000, 0)`), donc l'image `autowin-galaxy-bg-hq.png` de `body` passait au
 * travers. Un effacement OPAQUE fait du decor la seule source du fond.
 *
 * ENTREES QUI DOIVENT FAIRE ECHOUER CE TEST si la correction est fausse :
 *   - `FOND_DECOR.alpha = 0` (ou toute valeur < 1) → l'image plate repasse au travers ;
 *   - `setClearColor(0x000000, 0)` ecrit en dur a cote de la constante → l'assertion sur la source tombe.
 */
describe('le decor efface son canevas de maniere OPAQUE', () => {
  it('expose un fond noir opaque', () => {
    expect(FOND_DECOR.couleur).toBe(0x000000)
    expect(FOND_DECOR.alpha).toBe(1)
  })

  it('utilise cette constante pour l effacement, sans alpha 0 en dur', () => {
    const source = readFileSync(new URL('./home-decor-scene.ts', import.meta.url), 'utf8')
    expect(source).toMatch(/setClearColor\(\s*FOND_DECOR\.couleur\s*,\s*FOND_DECOR\.alpha\s*\)/)
    expect(source).not.toMatch(/setClearColor\([^)]*,\s*0(\.0+)?\s*\)/)
  })
})

/**
 * Le catalogue des directions du décor.
 *
 * La scène elle-même n'est pas testable ici : happy-dom n'a pas de WebGL, et c'est voulu — un décor
 * n'est pas une dépendance de la fonction, son absence doit laisser la page s'afficher. Ce qui EST
 * testable, et ce qui casserait silencieusement, c'est le contrat autour : le catalogue, le défaut, et
 * le fait qu'une valeur inconnue ne fasse pas tomber la vue.
 */
describe('directions du decor', () => {
  it('expose les quatre directions, chacune avec un nom et un resume', () => {
    expect(DECOR_VARIANTS.map((v) => v.id)).toEqual(['limbe', 'poussiere', 'orbites', 'nappe'])
    for (const variante of DECOR_VARIANTS) {
      expect(variante.nom.length).toBeGreaterThan(2)
      // Le resume sert a CHOISIR : une entree sans description ne serait qu'un identifiant.
      expect(variante.resume.length).toBeGreaterThan(20)
    }
  })

  it('a « poussiere » pour défaut, sans l avenue ni les planètes', () => {
    // `poussiere` redevient le defaut : il l'etait avant les planetes (2026-08-24). L'avenue, qui l'avait
    // remplace le 2026-10-17, est retiree du catalogue ; ce test refuse toute autre bascule non decidee.
    expect(DECOR_DEFAUT).toBe('poussiere')
    expect(DECOR_VARIANTS.some((v) => v.id === DECOR_DEFAUT)).toBe(true)
    expect(DECOR_VARIANTS.map((v) => v.id)).not.toContain('avenue')
  })

  /**
   * La direction vient du STOCKAGE local : une entree, pas une constante. Chaque cas limite doit
   * retomber sur le defaut, jamais sur une scene vide ni une erreur.
   */
  it('ne reconnait comme direction que les identifiants du catalogue', () => {
    // Les six directions connues sont reconnues.
    for (const variante of DECOR_VARIANTS) expect(estDirectionDecor(variante.id)).toBe(true)
    // Absente (`getItem` rend null), vide, mal typee, retiree ou inventee : refusee, donc defaut.
    for (const valeur of [null, undefined, '', ' avenue', 'AVENUE', 'planetes', 3, {}]) {
      expect(estDirectionDecor(valeur)).toBe(false)
    }
  })

  /**
   * La direction par defaut n'est pas qu'un identifiant : elle PROMET une image. Ces assertions
   * portent sur la composition reellement montee, pas sur le libelle — c'est ce qui casserait si
   * quelqu'un remettait une silhouette ou aplatissait la parallaxe en gardant le nom.
   */
  it('tient la promesse de « poussiere » : aucune silhouette, six plans, forte parallaxe', () => {
    // Vise `poussiere` par son NOM et non par `DECOR_DEFAUT` : elle n'est plus le defaut depuis le
    // 2026-08-24, mais elle reste choisissable -- et une direction qu'on peut choisir doit tenir sa
    // promesse. Perdre cette garantie en changeant de defaut aurait ete un dommage collateral.
    const poussiere = COMPOSITIONS['poussiere']
    // Aucune silhouette : ni planete, ni satellite — que de la matiere.
    expect(poussiere.planetes).toHaveLength(0)
    expect(poussiere.satellites).toBe(0)
    // Six plans de profondeur DISTINCTS : c'est la profondeur etagee qui fait le relief.
    expect(poussiere.nebuleuses).toHaveLength(6)
    expect(new Set(poussiere.nebuleuses.map((n) => n.z)).size).toBe(6)
    // Forte parallaxe : strictement au-dessus des autres directions composees, sinon « forte » ne
    // veut rien dire.
    for (const autre of SPATIALES.filter((id) => id !== 'poussiere')) {
      expect(poussiere.parallaxe).toBeGreaterThan(COMPOSITIONS[autre].parallaxe)
    }
    // Le resume affiche a l'utilisateur doit decrire CETTE image.
    const entree = DECOR_VARIANTS.find((v) => v.id === 'poussiere')
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
    // « Tres lente » : STRICTEMENT plus lente que toutes les autres directions composees.
    for (const autre of SPATIALES.filter((id) => id !== 'nappe')) {
      expect(nappe.tempo).toBeLessThan(COMPOSITIONS[autre].tempo)
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
