// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DiffView } from './DiffView'

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('DiffView', () => {
  it('colore les lignes ajout/suppression/hunk', () => {
    const diff = 'diff --git a/f b/f\n@@ -1,2 +1,2 @@\n const a = 1\n-const b = 2\n+const b = 3'
    act(() => root.render(createElement(DiffView, { diff })))
    expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull()
    expect(container.querySelectorAll('.diff-add')).toHaveLength(1)
    expect(container.querySelectorAll('.diff-del')).toHaveLength(1)
    expect(container.querySelector('.diff-hunk')).not.toBeNull()
  })

  it('diff vide → message', () => {
    act(() => root.render(createElement(DiffView, { diff: '' })))
    expect(container.querySelector('[data-testid="diff-view"]')).toBeNull()
    expect(container.textContent).toContain('Aucune différence')
  })
})
