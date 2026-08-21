import { describe, expect, it } from 'vitest'
import { createDecorScene, DECOR_DEFAUT, DECOR_VARIANTS } from './home-decor-scene'

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
    expect(DECOR_VARIANTS.map((v) => v.id)).toEqual(['actuel', 'limbe', 'poussiere', 'orbites'])
    for (const variante of DECOR_VARIANTS) {
      expect(variante.nom.length).toBeGreaterThan(2)
      // Le resume sert a CHOISIR : une entree sans description ne serait qu'un identifiant.
      expect(variante.resume.length).toBeGreaterThan(20)
    }
  })

  it('a « limbe » pour defaut — la direction choisie par l utilisateur sur rendus compares', () => {
    expect(DECOR_DEFAUT).toBe('limbe')
    expect(DECOR_VARIANTS.some((v) => v.id === DECOR_DEFAUT)).toBe(true)
  })

  it('rend null sans WebGL plutot que de jeter', () => {
    // C'est ce qui garantit que la page d'accueil s'affiche sur une machine sans pilote 3D.
    expect(createDecorScene()).toBeNull()
    expect(createDecorScene('limbe')).toBeNull()
  })
})
