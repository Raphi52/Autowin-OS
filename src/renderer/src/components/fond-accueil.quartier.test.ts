// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CLE_FOND_ACCUEIL,
  CLE_FOND_V3,
  FOND_DEFAUT,
  FOND_FALAISE,
  FONDS_ACCUEIL,
  fondSansScene,
  lireFondAccueil
} from './fond-accueil'

beforeEach(() => {
  window.localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('le Quartier dans le menu Fond', () => {
  it('est le fond par défaut, et il monte une scène', () => {
    expect(FOND_DEFAUT).toBe(FOND_FALAISE)
    expect(lireFondAccueil()).toBe(FOND_FALAISE)
    expect(fondSansScene(FOND_FALAISE)).toBe(false)
  })

  it('se choisit dans le menu, sans le Cyberpunk ni les Planètes, retirés', () => {
    const ids = FONDS_ACCUEIL.map((f) => f.id)
    expect(ids).toContain(FOND_FALAISE)
    expect(ids).not.toContain('avenue')
    expect(ids).toContain('noir')
  })

  it('remplace un fond reçu par défaut sur un poste déjà installé', () => {
    window.localStorage.setItem(CLE_FOND_V3, 'avenue')
    expect(lireFondAccueil()).toBe(FOND_FALAISE)
    window.localStorage.setItem(CLE_FOND_V3, 'actuel')
    expect(lireFondAccueil()).toBe(FOND_FALAISE)
  })

  it('n’écrase pas un fond sans décor choisi exprès', () => {
    window.localStorage.setItem(CLE_FOND_V3, 'noir')
    expect(lireFondAccueil()).toBe('noir')
    window.localStorage.setItem(CLE_FOND_V3, 'nier')
    expect(lireFondAccueil()).toBe('nier')
  })

  it('un Cyberpunk ou des Planètes enregistrés avant leur retrait retombent sur le Quartier', () => {
    window.localStorage.setItem(CLE_FOND_ACCUEIL, 'avenue')
    expect(lireFondAccueil()).toBe(FOND_FALAISE)
    window.localStorage.setItem(CLE_FOND_ACCUEIL, 'actuel')
    expect(lireFondAccueil()).toBe(FOND_FALAISE)
  })
})
