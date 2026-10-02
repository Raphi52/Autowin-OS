// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

/**
 * conv-61 (2026-10-02) : l'agent a donne l'adresse du prototype en gras,
 * « Ouvre **https://professional-distributors-valium-poetry.trycloudflare.com** ».
 * Le gras etait rendu en texte brut : l'adresse s'affichait sans etre cliquable.
 */
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
  act(() => root.render(createElement(Markdown, { text })))
}

describe('lien a l interieur d une mise en forme', () => {
  it('une adresse en gras reste cliquable', () => {
    render('1. Ouvre **https://exemple.trycloudflare.com** et entre le code **147913**.')
    const a = container.querySelector('strong a') as HTMLAnchorElement | null
    expect(a?.getAttribute('href')).toBe('https://exemple.trycloudflare.com')
    expect(container.textContent).toContain('147913')
  })
  it('un lien markdown en italique ou barre reste cliquable', () => {
    render('voir *[doc](https://a.example/x)* et ~~https://b.example~~')
    expect(container.querySelector('em a')?.getAttribute('href')).toBe('https://a.example/x')
    expect(container.querySelector('del a')?.getAttribute('href')).toBe('https://b.example')
  })
})
