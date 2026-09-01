// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
  // 2026-09-01 : le pave de pensee arrive PLIE, meme en cours — seul l'en-tete dit que ca pense.
  it('est PLIÉ mais étiqueté « en cours » tant que le tour stream', () => {
    const el = render({ text: 'je pèse les options', done: false })
    const details = el.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Réflexion…')
    expect(el.querySelector('[data-testid="thinking-body"]')!.textContent).toBe(
      'je pèse les options'
    )
  })

  it('reste replié et change de libellé une fois le tour terminé', () => {
    const el = render({ text: 'fini', done: true })
    const details = el.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    expect(details.open).toBe(false)
    expect(details.textContent).toContain('Réflexion terminée')
  })

  it("laisse l'utilisateur ouvrir le bloc, terminé comme en cours", () => {
    for (const done of [true, false]) {
      const hote = render({ text: 'fini', done })
      const bloc = hote.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
      act(() => {
        bloc.open = true
        bloc.dispatchEvent(new Event('toggle', { bubbles: false }))
      })
      expect(bloc.open, `déplié impossible avec done=${done}`).toBe(true)
      act(() => root?.unmount())
      hote.remove()
    }
    const el = render({ text: 'fini', done: true })
    const details = el.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    act(() => {
      details.open = true
      details.dispatchEvent(new Event('toggle', { bubbles: false }))
    })
    expect(details.open).toBe(true)
  })
})

/**
 * MARQUEUR DU SUMMARY (grief du 2026-09-01 : « la petite fleche […] on voit pas ou elle pointe »).
 * Le rendu de `::after` n'est pas observable dans happy-dom : l'oracle porte donc sur la REGLE, qui
 * est ce que le navigateur applique. ENTREE QUI FAIT ECHOUER UNE FAUSSE CORRECTION : un simple
 * grossissement du glyphe « ▾ » laisserait `content` non vide et aucune rotation directionnelle.
 */
describe('chevron du bloc Réflexion', () => {
  const css = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'ChatView.css'),
    'utf8'
  )
  const corps = (selecteur: string): string => {
    const i = css.indexOf(selecteur + ' {')
    expect(i, 'règle absente : ' + selecteur).toBeGreaterThan(-1)
    return css.slice(i + selecteur.length + 2, css.indexOf('}', i))
  }

  it('est DESSINÉ (bordures épaisses), pas un glyphe minuscule', () => {
    const regle = corps('.thinking-block > summary::after')
    expect(regle).toMatch(/content:\s*''/)
    expect(regle).toMatch(/border-right:\s*1\.5px solid/)
    expect(regle).toMatch(/border-bottom:\s*1\.5px solid/)
    expect(regle).toMatch(/width:\s*6px/)
  })

  it('pointe à DROITE fermé et vers le HAUT ouvert', () => {
    expect(corps('.thinking-block > summary::after')).toMatch(/transform:\s*rotate\(-45deg\)/)
    expect(corps('.thinking-block[open] > summary::after')).toMatch(
      /transform:\s*rotate\(-135deg\)/
    )
  })
})
