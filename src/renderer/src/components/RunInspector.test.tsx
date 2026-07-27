// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RunInspector } from './RunInspector'

let container: HTMLDivElement
let root: Root
const originalScrollIntoView = Element.prototype.scrollIntoView

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    value: originalScrollIntoView,
    configurable: true
  })
})

describe('RunInspector', () => {
  it('rend la synthèse, les sections navigables et le Markdown d’un RUN complet', () => {
    act(() =>
      root.render(
        createElement(RunInspector, {
          content: `status: open\nregime: standard\n\n## Besoin\n- [x] Déjà fait\n- [ ] À faire\n\n## Contraintes\nTexte\n\n## Options\n| Option | Choix |\n| - | - |\n| A | oui |\n\n## SOP\n1. Vérifier\n\n## Journal\n[2026-07-21] événement\n\n## Défauts\n- Aucun\n\n## Reprise\nContinuer`,
          summary: { status: 'open', regime: 'standard', dodChecked: 1, dodTotal: 2, journalEvents: 1, defauts: 1 }
        })
      )
    )

    expect(container.querySelector('[data-testid="run-summary"]')?.textContent).toContain('1/2')
    expect(container.querySelectorAll('[data-testid="run-section-nav"] button')).toHaveLength(7)
    expect(container.querySelector('.brain-markdown')).not.toBeNull()
    expect(container.textContent).toContain('À faire')
  })

  it('navigue vers la bonne section même si une section précédente est absente', () => {
    const scrollIntoView = vi.fn()
    Object.defineProperty(Element.prototype, 'scrollIntoView', { value: scrollIntoView, configurable: true })
    act(() =>
      root.render(
        createElement(RunInspector, {
          content: '## Besoin\nTexte\n\n## Journal\n[2026-07-21] événement',
          summary: { status: 'open', dodChecked: 0, dodTotal: 0, journalEvents: 1, defauts: 0 }
        })
      )
    )

    const buttons = [...container.querySelectorAll<HTMLButtonElement>('[data-testid="run-section-nav"] button')]
    act(() => buttons.find((button) => button.textContent === 'Journal')?.click())
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
  })

  it('signale explicitement les sections absentes sans casser le rendu Markdown', () => {
    act(() =>
      root.render(
        createElement(RunInspector, {
          content: 'status: green\n\n## Besoin\n- [x] Terminé',
          summary: { status: 'green', dodChecked: 1, dodTotal: 1, journalEvents: 0, defauts: 0 }
        })
      )
    )

    expect(container.textContent).toContain('Journal absent')
    expect(container.textContent).toContain('Défauts absent')
    expect(container.querySelector('.brain-markdown')).not.toBeNull()
  })
})
