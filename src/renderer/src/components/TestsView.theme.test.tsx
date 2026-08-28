// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TestsView } from './TestsView'

/**
 * Divergence signalee a l'oeil : la vue Tests etait la SEULE vue de contenu sans `.view-page` ni
 * `ViewTopBar`, avec un fond opaque et des bordures en dur au lieu des tokens. Ce test verrouille
 * la convergence sur les DEUX plans : structure rendue (barre + cadre partages) et feuille CSS
 * (tokens, pas de couleurs en dur pour le fond/les bordures).
 *
 * Entree qui doit FAIRE ECHOUER ce test si la correction etait fausse : remettre dans
 * `TestsView.css` la regle `background: rgba(8, 11, 20, 0.92)` sur `.tests-view`, ou retirer
 * `<ViewTopBar .../>` du JSX -> le bloc "structure" ou le bloc "feuille" repasse au rouge.
 */
describe('TestsView — meme theme que les autres vues', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('rend le cadre de page et LA barre du haut partages', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { testProjects: vi.fn(async () => []) }
    })
    const container = document.createElement('div')
    document.body.append(container)
    await act(async () => {
      createRoot(container).render(createElement(TestsView, { active: true }))
      await Promise.resolve()
    })
    const racine = container.querySelector('[data-testid="tests-view"]')
    expect(racine).toBeTruthy()
    expect([...(racine as HTMLElement).classList]).toContain('view-page')
    // La barre du haut vient du composant partage, pas d'un <h2> maison.
    expect(container.querySelector('.view-topbar')).toBeTruthy()
    expect(container.querySelector('.view-topbar .module-header')).toBeTruthy()
    expect(container.querySelector('.tests-view > h2')).toBeNull()
    expect(container.textContent).toContain('Tests')
  })

  it('la feuille consomme les tokens et ne peint plus de fond opaque en dur', () => {
    // happy-dom : import.meta.url n'est pas un file:// -> chemin depuis la racine du depot.
    const dossier = resolve(process.cwd(), 'src/renderer/src/components')
    const css = readFileSync(resolve(dossier, 'TestsView.css'), 'utf8')
    const jsx = readFileSync(resolve(dossier, 'TestsView.tsx'), 'utf8')
    expect(jsx).toContain("import './ViewPage.css'")
    expect(jsx).toContain('ViewTopBar')
    // Aucun fond/bordure en dur : les couleurs de structure passent par les tokens.
    expect(css).not.toMatch(/background:\s*rgba\(8,\s*11,\s*20/)
    expect(css).not.toMatch(/border[^;]*:\s*1px solid rgba\(255,\s*255,\s*255/)
    expect(css).toMatch(/var\(--line\)/)
    expect(css).toMatch(/var\(--surface/)
  })
})
