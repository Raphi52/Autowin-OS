// @vitest-environment happy-dom
/*
 * LA FENCE ```mermaid EST RENDUE EN DIAGRAMME DANS LE FIL — et, surtout, ses cas limites retombent
 * sur le bloc de code plutot que de fabriquer un rendu vide ou de faire echouer la bulle.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'
import { decouperMarkdownSansReprise, MAX_MERMAID_CHARS } from './markdown-blocs'

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

const render = (text: string): void => {
  act(() => root.render(createElement(Markdown, { text })))
}
const kinds = (text: string): string[] => decouperMarkdownSansReprise(text).map((bloc) => bloc.kind)

describe('Markdown — diagrammes Mermaid', () => {
  it('rend une fence mermaid fermee comme un diagramme, pas comme du code', () => {
    render('Voici le flux :\n\n```mermaid\nflowchart LR\n  A --> B\n```')
    expect(container.querySelector('[data-testid="chat-inline-mermaid"]')).not.toBeNull()
    expect(container.querySelector('pre.md-code')).toBeNull()
    expect(container.textContent).toContain('Voici le flux')
  })

  it('garde le code source quand la source est vide ou seulement des blancs', () => {
    expect(kinds('```mermaid\n```')).toEqual(['code'])
    expect(kinds('```mermaid\n   \n\n```')).toEqual(['code'])
    render('```mermaid\n```')
    expect(container.querySelector('[data-testid="chat-inline-mermaid"]')).toBeNull()
  })

  it('laisse une fence ENCORE OUVERTE en code — le diagramme attend la cloture', () => {
    expect(kinds('```mermaid\nflowchart LR\n  A --> B')).toEqual(['code'])
    render('```mermaid\nflowchart LR\n  A --> B')
    expect(container.querySelector('[data-testid="chat-inline-mermaid"]')).toBeNull()
    expect(container.querySelector('pre.md-code')).not.toBeNull()
  })

  it('retombe sur le code au-dela de la borne que mermaid refuse lui-meme', () => {
    const enorme = `flowchart LR\n${'  A --> B\n'.repeat(9000)}`
    expect(enorme.length).toBeGreaterThan(MAX_MERMAID_CHARS)
    expect(kinds('```mermaid\n' + enorme + '```')).toEqual(['code'])
  })

  it('ne confond pas mermaid avec un bloc de code ordinaire qui en parle', () => {
    expect(kinds('```txt\nflowchart LR\n  A --> B\n```')).toEqual(['code'])
  })
})
