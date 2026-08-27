// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

let container: HTMLDivElement
let root: Root
let ouvertures: Array<{ path: string; line: number | undefined }>

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ouvertures = []
  ;(window as unknown as { api: Record<string, unknown> }).api = {
    revealFile: (path: string, line?: number) => {
      ouvertures.push({ path, line })
      return Promise.resolve({ ok: true })
    }
  }
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

describe('Markdown — les liens vers des fichiers sont cliquables', () => {
  it('rend un lien fichier en <a> et l’ouvre au clic avec sa ligne', () => {
    render('preuve : [orchestrator.ts:80](src/main/orchestrator.ts:80)')
    const lien = container.querySelector('a.md-ref') as HTMLAnchorElement | null
    expect(lien).not.toBeNull()
    expect(lien?.textContent).toBe('orchestrator.ts:80')
    expect(lien?.dataset.path).toBe('src/main/orchestrator.ts')
    expect(lien?.dataset.line).toBe('80')
    act(() => {
      lien?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(ouvertures).toEqual([{ path: 'src/main/orchestrator.ts', line: 80 }])
  })

  it('rend un lien fichier sans ligne', () => {
    render('[README](README.md)')
    const lien = container.querySelector('a.md-ref') as HTMLAnchorElement | null
    expect(lien?.dataset.path).toBe('README.md')
    act(() => {
      lien?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
    })
    expect(ouvertures).toEqual([{ path: 'README.md', line: undefined }])
  })

  // Entrées qui doivent faire ÉCHOUER une correction trop permissive : elles restent du `code`,
  // jamais un `<a>` cliquable.
  it.each(['[x](javascript:alert(1))', '[x](#ancre)', '[x](mailto:a@b.fr)', '[x](notes/dossier/)'])(
    'ne rend pas %s cliquable',
    (texte) => {
      render(texte)
      expect(container.querySelector('a.md-ref')).toBeNull()
      expect(container.querySelector('code.md-ref')).not.toBeNull()
    }
  )

  it('garde les liens http en <a href> externe', () => {
    render('[site](https://exemple.fr)')
    const lien = container.querySelector('a') as HTMLAnchorElement
    expect(lien.getAttribute('href')).toBe('https://exemple.fr')
    expect(lien.classList.contains('md-ref')).toBe(false)
  })
})
