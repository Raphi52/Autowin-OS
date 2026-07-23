// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SuggestionGrid } from './SuggestionGrid'
import type { SuggestionGroup } from './scout-suggestions'

let container: HTMLDivElement
let root: Root
afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})
function render(props: Parameters<typeof SuggestionGrid>[0]): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root.render(createElement(SuggestionGrid, props)))
}

const GROUPS: SuggestionGroup[] = [
  { key: 'A', title: 'Découverte', items: [{ label: 'Que peux-tu faire ?' }, { label: 'Crée une conv' }] },
  { key: 'B', title: 'Avancé', subtitle: 'score le plus haut', items: [{ label: 'Mets le juge sur codex' }] }
]

describe('SuggestionGrid', () => {
  it('rend un groupe par catégorie et une chip par item', () => {
    render({ groups: GROUPS, onPick: () => {} })
    expect(container.querySelectorAll('[data-testid="sg-group"]')).toHaveLength(2)
    expect(container.querySelectorAll('[data-testid="sg-chip"]')).toHaveLength(3)
    expect(container.textContent).toContain('score le plus haut')
  })

  it('un clic sur une chip envoie son label comme prompt', () => {
    const onPick = vi.fn()
    render({ groups: GROUPS, onPick })
    const chip = container.querySelector('[data-testid="sg-chip"]') as HTMLButtonElement
    act(() => chip.click())
    expect(onPick).toHaveBeenCalledWith('Que peux-tu faire ?')
  })
})
