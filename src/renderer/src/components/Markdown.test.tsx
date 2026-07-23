// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown, extractRecommendation } from './Markdown'

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

function render(text: string, highlightFinalSummary = false): void {
  act(() => root.render(createElement(Markdown, { text, highlightFinalSummary })))
}

describe('Markdown', () => {
  it('renders "- " lines as a real bullet list', () => {
    render('- a\n- b')
    const items = container.querySelectorAll('ul > li')
    expect(items.length).toBe(2)
    expect(items[0].textContent).toBe('a')
    expect(items[1].textContent).toBe('b')
  })

  it('renders [text](http url) as a clickable anchor with safe rel/target', () => {
    render('voir [doc](https://example.com/x)')
    const a = container.querySelector('a')
    expect(a).not.toBeNull()
    expect(a?.getAttribute('href')).toBe('https://example.com/x')
    expect(a?.textContent).toBe('doc')
    expect(a?.getAttribute('rel')).toContain('noopener')
    expect(a?.getAttribute('target')).toBe('_blank')
  })

  it('does NOT create an anchor for a non-http(s) scheme', () => {
    render('[x](javascript:alert(1))')
    expect(container.querySelector('a')).toBeNull()
  })

  it('still renders code and bold inline', () => {
    render('a `b` **c**')
    expect(container.querySelector('code')?.textContent).toBe('b')
    expect(container.querySelector('strong')?.textContent).toBe('c')
  })

  it('groups the model final summary in one dedicated region and absorbs its separator', () => {
    render(
      'Réponse détaillée.\n\n---\n\n✅ Fait\n1. Correctif appliqué.\n\n📍 Maintenant : vérifié.\n⏳ Reste à faire : rien.\n👉 Recommandé : tester.',
      true
    )

    const summary = container.querySelector('.md-final-summary')
    expect(summary).not.toBeNull()
    expect(summary?.textContent).toContain('✅ Fait')
    expect(summary?.textContent).toContain('👉 Recommandé : tester.')
    expect(summary?.textContent).not.toContain('---')
    expect(summary?.textContent).not.toContain('Réponse détaillée.')
  })

  it('requires all four final-summary labels in order before framing', () => {
    const invalidSummaries = [
      '✅ Fait\n1. Correctif appliqué.\n⏳ Reste à faire : rien.\n👉 Recommandé : tester.',
      '✅ Fait\n1. Correctif appliqué.\n📍 Maintenant : vérifié.\n👉 Recommandé : tester.',
      '✅ Fait\n1. Correctif appliqué.\n📍 Maintenant : vérifié.\n⏳ Reste à faire : rien.',
      '✅ Fait\n1. Correctif appliqué.\n👉 Recommandé : tester.\n⏳ Reste à faire : rien.\n📍 Maintenant : vérifié.'
    ]

    for (const text of invalidSummaries) {
      render(text, true)
      expect(container.querySelector('.md-final-summary')).toBeNull()
    }
  })

  it('does not frame an unmarked render or a marker inside fenced code', () => {
    render('✅ Fait\n1. Texte utilisateur.')
    expect(container.querySelector('.md-final-summary')).toBeNull()

    render('```text\n✅ Fait\n```', true)
    expect(container.querySelector('.md-final-summary')).toBeNull()
  })
})

describe('extractRecommendation — ghost-text du composer', () => {
  it('extrait la reco avec libellé en gras et deux-points', () => {
    const txt = "blabla\n\n✅ Fait\n📍 Maintenant : x\n⏳ Reste : y\n👉 **Recommandé** : relance le build"
    expect(extractRecommendation(txt)).toBe('relance le build')
  })
  it('gère le tiret — comme séparateur', () => {
    expect(extractRecommendation('👉 Recommandé — teste la lecture')).toBe('teste la lecture')
  })
  it('ignore une ligne 👉 SANS « Recommandé » (déclenche seulement sur la vraie reco)', () => {
    expect(extractRecommendation('👉 fais X maintenant')).toBeNull()
  })
  it('retire le gras et les backticks du texte', () => {
    expect(extractRecommendation('👉 Recommandé : lance `npm run dev` et **vérifie**')).toBe(
      'lance npm run dev et vérifie'
    )
  })
  it('rend null si aucune ligne 👉', () => {
    expect(extractRecommendation('juste du texte\nsans reco')).toBeNull()
  })
})
