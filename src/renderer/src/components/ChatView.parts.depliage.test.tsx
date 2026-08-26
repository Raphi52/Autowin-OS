// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SubAgentText } from './ChatView.parts'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function render(text: string): void {
  act(() => root.render(createElement(SubAgentText, { text })))
}

const bouton = (): HTMLElement | null => container.querySelector('.subagent-text-toggle')

describe('depliage de la sortie d un sous-agent', () => {
  it('ne propose pas de deplier un texte qui tient dans le cadre', () => {
    render('Deux lignes.\nRien de plus a montrer.')
    expect(container.querySelector('.subagent-text')?.textContent).toContain('Deux lignes.')
    expect(bouton()).toBeNull()
  })

  it('propose de deplier un texte plus long que le cadre', () => {
    render(Array.from({ length: 20 }, (_, i) => `ligne ${i}`).join('\n'))
    expect(bouton()).not.toBeNull()
  })

  it('compte aussi les lignes repliees par la largeur du panneau', () => {
    // Une seule ligne source, mais ~12 lignes rendues : le cadre deborde quand meme.
    render('x'.repeat(1200))
    expect(bouton()).not.toBeNull()
  })

  it('deplie et replie au clic', () => {
    render(Array.from({ length: 20 }, (_, i) => `ligne ${i}`).join('\n'))
    expect(bouton()?.getAttribute('aria-expanded')).toBe('false')
    act(() => bouton()?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(bouton()?.getAttribute('aria-expanded')).toBe('true')
    expect(container.querySelector('.subagent-text')?.className).toContain('open')
  })
})
