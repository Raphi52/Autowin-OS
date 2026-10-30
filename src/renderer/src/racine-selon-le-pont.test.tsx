// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pontElectronPresent, racineSelonLePont } from './racine-selon-le-pont'

/**
 * L'interface ouverte dans un navigateur ordinaire (conv-1286). Entrée qui doit faire échouer ce
 * fichier : une interface montée sans le pont `window.api` (elle plante et laisse un écran noir),
 * ou l'écran d'explication montré à la place de l'interface alors que le pont est là.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

/** Une interface qui lit le pont comme `App.tsx` : sans lui, elle lève l'erreur de l'écran noir. */
function InterfaceQuiLitLePont({ fenetre }: { fenetre: { api?: { nom: string } } }): ReactElement {
  return createElement('p', { 'data-testid': 'interface' }, fenetre.api!.nom)
}

describe('pontElectronPresent', () => {
  it('vrai seulement quand window.api est un objet', () => {
    expect(pontElectronPresent({ api: {} })).toBe(true)
    expect(pontElectronPresent({})).toBe(false)
    expect(pontElectronPresent({ api: undefined })).toBe(false)
    expect(pontElectronPresent({ api: null })).toBe(false)
    expect(pontElectronPresent(undefined)).toBe(false)
  })
})

describe('racineSelonLePont', () => {
  it('sans pont : l’explication à la place de l’interface, qui n’est jamais montée', () => {
    const fenetre = {}
    act(() =>
      root.render(racineSelonLePont(fenetre, createElement(InterfaceQuiLitLePont, { fenetre })))
    )
    expect(container.querySelector('[data-testid="interface"]')).toBeNull()
    const ecran = container.querySelector('[data-testid="hors-electron"]')
    expect(ecran?.getAttribute('role')).toBe('alert')
    expect(ecran?.textContent).toContain('ne s’ouvre que dans l’application Autowin OS')
    expect(ecran?.textContent).toContain('npm run dev')
  })

  it('avec le pont : l’interface, sans l’explication', () => {
    const fenetre = { api: { nom: 'interface complète' } }
    act(() =>
      root.render(racineSelonLePont(fenetre, createElement(InterfaceQuiLitLePont, { fenetre })))
    )
    expect(container.querySelector('[data-testid="interface"]')?.textContent).toBe(
      'interface complète'
    )
    expect(container.querySelector('[data-testid="hors-electron"]')).toBeNull()
  })

  it('main.tsx monte l’interface par ce choix, jamais <App /> en direct', () => {
    const source = readFileSync(join(__dirname, 'main.tsx'), 'utf8')
    expect(source).toMatch(/racineSelonLePont\(window,\s*<App \/>\)/)
  })
})
