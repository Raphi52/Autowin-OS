// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import { CLE_FOND_ACCUEIL, FOND_DEFAUT, FOND_FALAISE, lireFondAccueil } from './fond-accueil'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

/**
 * LE QUARTIER EST LE SEUL FOND DE L'ACCUEIL : aucun menu ne propose autre chose, et un poste qui
 * avait choisi un fond retiré retombe dessus. Entrée qui doit faire échouer ce test : rendre
 * « Aucun » (`noir`) ou le radar (`nier`) enregistrés, ou rendre au thème Nier son radar par défaut.
 */
describe('le fond de l Accueil', () => {
  it('est le Quartier quand rien n est enregistré, sous tous les thèmes', () => {
    expect(FOND_DEFAUT).toBe(FOND_FALAISE)
    expect(lireFondAccueil()).toBe(FOND_FALAISE)
    document.documentElement.setAttribute('data-theme', 'nier-automata')
    expect(lireFondAccueil()).toBe(FOND_FALAISE)
  })

  it('ramène au Quartier chaque fond retiré, Aucun et le radar Nier compris', () => {
    for (const retire of ['noir', 'nier', 'avenue', 'actuel']) {
      window.localStorage.setItem(CLE_FOND_ACCUEIL, retire)
      expect(lireFondAccueil(), retire).toBe(FOND_FALAISE)
    }
  })

  it('garde une direction 3D enregistrée à la main', () => {
    window.localStorage.setItem(CLE_FOND_ACCUEIL, 'limbe')
    expect(lireFondAccueil()).toBe('limbe')
  })
})
