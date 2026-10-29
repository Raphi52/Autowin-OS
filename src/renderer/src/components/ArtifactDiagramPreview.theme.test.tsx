// @vitest-environment happy-dom
/*
 * UN SCHÉMA SUIT LE CHANGEMENT DE THÈME (conv-1235, 2026-10-28).
 *
 * Les couleurs du schéma sont lues sur le thème appliqué au moment du dessin. Changer de thème
 * doit donc le REDESSINER — sous un identifiant neuf : `mermaid.render` retire d'abord du document
 * l'élément qui porte son identifiant, c'est-à-dire le schéma affiché.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mermaidMock = vi.hoisted(() => ({
  initialize: vi.fn(),
  render: vi.fn(async (id: string) => ({ svg: `<svg data-dessin="${id}"></svg>` }))
}))
vi.mock('mermaid', () => ({ default: mermaidMock }))

import { ArtifactDiagramPreview } from './ArtifactDiagramPreview'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  mermaidMock.initialize.mockClear()
  mermaidMock.render.mockClear()
  document.documentElement.removeAttribute('data-base')
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.documentElement.removeAttribute('data-base')
})

const attendre = async (condition: () => boolean): Promise<void> => {
  for (let i = 0; i < 50 && !condition(); i += 1)
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
  expect(condition()).toBe(true)
}

describe('ArtifactDiagramPreview — thème', () => {
  it('redessine sous un identifiant neuf quand le thème change, en mode strict', async () => {
    act(() =>
      root.render(createElement(ArtifactDiagramPreview, { source: 'flowchart LR\n A --> B' }))
    )
    await attendre(() => container.querySelector('svg[data-dessin]') !== null)
    const premier = mermaidMock.render.mock.calls.length
    const idAvant = mermaidMock.render.mock.calls.at(-1)?.[0]

    act(() => document.documentElement.setAttribute('data-base', 'clair'))
    await attendre(() => mermaidMock.render.mock.calls.length > premier)
    const idApres = mermaidMock.render.mock.calls.at(-1)?.[0]

    expect(idApres).not.toBe(idAvant)
    await attendre(() => container.querySelector(`svg[data-dessin="${String(idApres)}"]`) !== null)
    // Le thème ne remplace JAMAIS le niveau de sécurité.
    expect(mermaidMock.initialize).toHaveBeenLastCalledWith(
      expect.objectContaining({ securityLevel: 'strict' })
    )
  })
})
