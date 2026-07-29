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

  it('renders markdown headings as real heading elements', () => {
    render('# Titre\n## Sous-titre **fort**\ntexte')
    const h1 = container.querySelector('h1.md-h')
    const h2 = container.querySelector('h2.md-h')
    expect(h1?.textContent).toBe('Titre')
    expect(h2?.textContent).toBe('Sous-titre fort')
    expect(h2?.querySelector('strong')?.textContent).toBe('fort')
    expect(container.textContent).not.toContain('#')
  })

  it('renders a GFM table as a real <table> with <th>/<td>', () => {
    render('| Score | Quoi |\n| --- | --- |\n| 88 | a |\n| 12 | b |')
    const table = container.querySelector('table.md-table')
    expect(table).not.toBeNull()
    const th = table!.querySelectorAll('thead th')
    expect(th.length).toBe(2)
    expect(th[0].textContent).toBe('Score')
    const rows = table!.querySelectorAll('tbody tr')
    expect(rows.length).toBe(2)
    expect(rows[0].querySelectorAll('td').length).toBe(2)
    expect(rows[1].querySelectorAll('td')[1].textContent).toBe('b')
    // pas de pipes bruts laissés dans le DOM
    expect(container.textContent).not.toContain('|')
  })

  it('honours column alignment from the separator row', () => {
    render('| a | b | c |\n| :--- | :---: | ---: |\n| 1 | 2 | 3 |')
    const cells = container.querySelectorAll('tbody td')
    expect((cells[0] as HTMLElement).style.textAlign).toBe('left')
    expect((cells[1] as HTMLElement).style.textAlign).toBe('center')
    expect((cells[2] as HTMLElement).style.textAlign).toBe('right')
  })

  it('badges numeric scores and statuses by threshold', () => {
    render('| Score | Etat |\n| --- | --- |\n| 88 | OK |\n| 55 | partiel |\n| 10 | KO |')
    const badges = container.querySelectorAll('.md-badge')
    expect(badges.length).toBe(6)
    expect(badges[0].className).toContain('md-badge-good')
    expect(badges[1].className).toContain('md-badge-good')
    expect(badges[2].className).toContain('md-badge-warn')
    expect(badges[3].className).toContain('md-badge-warn')
    expect(badges[4].className).toContain('md-badge-bad')
    expect(badges[5].className).toContain('md-badge-bad')
  })

  it('leaves prose and non-score cells unbadged, and needs a separator row', () => {
    render('| a |\n| --- |\n| juste du texte |')
    expect(container.querySelector('.md-badge')).toBeNull()

    render('| a | b |\n| c | d |')
    expect(container.querySelector('table')).toBeNull()
    expect(container.textContent).toContain('| a | b |')
  })

  it('does not turn a table inside fenced code into a <table>', () => {
    render('```\n| a |\n| --- |\n| 1 |\n```')
    expect(container.querySelector('table')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('| a |')
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

  it('groups final-summary labels written as Markdown headings', () => {
    render(
      '## ✅ Fait\nCorrectif appliqué.\n\n## 📍 Maintenant\nVérifié.\n\n## ⏳ Reste à faire\nRien.\n\n## 👉 Recommandé\nTester.',
      true
    )

    expect(container.querySelector('.md-final-summary')).not.toBeNull()
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
