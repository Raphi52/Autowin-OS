// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ThinkingBlock } from './ThinkingBlock'

 ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null

function render(props: { text: string; done: boolean }): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(createElement(ThinkingBlock, props)))
  return host
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
})

describe('bloc Réflexion', () => {
  it('est OUVERT et étiqueté « en cours » tant que le tour stream', () => {
    const el = render({ text: 'je pèse les options', done: false })
    const details = el.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    expect(details.open).toBe(true)
    expect(details.textContent).toContain('Réflexion…')
    expect(el.querySelector('[data-testid="thinking-body"]')!.textContent).toBe(
      'je pèse les options'
    )
  })

  it('se replie et change de libellé une fois le tour terminé', () => {
    const el = render({ text: 'fini', done: true })
    const details = el.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Réflexion terminée')
  })

  it("laisse l'utilisateur ouvrir le bloc d'un tour terminé", () => {
    const el = render({ text: 'fini', done: true })
    const details = el.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle', { bubbles: false }))
    })
    expect(details.open).toBe(true)
  })
})
