// @vitest-environment happy-dom
// happy-dom, comme les 353 autres tests de l'interface : jsdom n'est pas une dépendance du dépôt, ce
// fichier ne se chargeait pas (« Cannot find package jsdom », salvage conv-1096).
import { afterEach, describe, expect, it } from 'vitest'
import { CLE_FOND_ACCUEIL, DECOR_DEFAUT, FONDS_ACCUEIL, FOND_NIER, fondSansScene, lireFondAccueil } from './fond-accueil'

afterEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('fond « Nier Automata (radar) » (conv-295)', () => {
  it('est proposé dans le menu et ne monte aucune scène 3D', () => {
    expect(FONDS_ACCUEIL.find((f) => f.id === FOND_NIER)?.nom).toBe('Nier Automata (radar)')
    expect(fondSansScene(FOND_NIER)).toBe(true)
    expect(fondSansScene('avenue')).toBe(false)
  })
  it('est le défaut sous le thème Nier Automata, pas ailleurs', () => {
    expect(lireFondAccueil()).toBe(DECOR_DEFAUT)
    document.documentElement.setAttribute('data-theme', 'nier-automata')
    expect(lireFondAccueil()).toBe(FOND_NIER)
  })
  it('le choix du menu l’emporte sur le thème', () => {
    document.documentElement.setAttribute('data-theme', 'nier-automata')
    window.localStorage.setItem(CLE_FOND_ACCUEIL, 'avenue')
    expect(lireFondAccueil()).toBe('avenue')
  })
})
