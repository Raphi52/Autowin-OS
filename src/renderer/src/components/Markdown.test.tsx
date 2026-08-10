// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { groupAssistantActivity, hydrateStoredAssistant } from './chat-view-model'
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

const CLOSURE = 'Clôture Autowin : gate validé, RUN fermé green ; publication terminée.'

function renderHydrated(
  message: Parameters<typeof hydrateStoredAssistant>[0],
  highlightFinalSummary = false
): void {
  const hydrated = hydrateStoredAssistant(message)
  const texts = groupAssistantActivity(hydrated.parts).filter((part) => part.kind === 'text')
  act(() =>
    root.render(
      createElement(
        'div',
        null,
        ...texts.map((part, index) =>
          createElement(Markdown as React.ComponentType<Record<string, unknown>>, {
            key: index,
            text: part.text,
            continuationPrefix: (part as { markdownContinuationPrefix?: string })
              .markdownContinuationPrefix,
            highlightFinalSummary
          })
        )
      )
    )
  )
}

function textOutsideCode(): string {
  const copy = container.cloneNode(true) as HTMLElement
  copy.querySelectorAll('pre').forEach((node) => node.remove())
  return copy.textContent ?? ''
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

  // Le rendu du chat n'est plus une iframe encadrée mais un rendu INLINE assaini (décision
  // utilisateur 2026-08-08 : « ça doit pas faire une boîte »). L'intention testée est inchangée —
  // seule une fence FERMÉE `html-render` produit une surface rendue — mais la surface a changé.
  it('renders only a closed html-render fence as inline sanitized content', () => {
    render('Avant\n```html-render\n<!doctype html><button id="demo">Démo</button>\n```\nAprès')
    const rendered = container.querySelector('[data-testid="chat-inline-html"]')
    expect(rendered).not.toBeNull()
    expect(container.querySelector('iframe')).toBeNull()
    // `<button>` n'est pas dans la whitelist : le libellé survit, la balise non.
    expect(rendered?.textContent).toContain('Démo')
    expect(rendered?.querySelector('button')).toBeNull()
    expect(container.textContent).toContain('Avant')
    expect(container.textContent).toContain('Après')
  })

  it('keeps ordinary and incomplete HTML fences inert', () => {
    render('```html\n<script>window.evil = true</script>\n```')
    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('<script>')

    render('```html-render\n<script>window.evil = true</script>')
    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('<script>')
  })

  it('accepts Markdown fence indentation without rendering ordinary HTML', () => {
    render('1. Vue proposée\n   ```html-render\n   <strong>Rendue</strong>\n   ```')
    expect(container.querySelector('[data-testid="chat-inline-html"]')).not.toBeNull()

    render('1. Exemple\n   ```html\n   <strong>Code</strong>\n   ```')
    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('<strong>Code</strong>')
  })

  it('recreates the same rendered surface from persisted text', () => {
    const persisted = JSON.parse(
      JSON.stringify({ content: '```html-render\n<h1>Après redémarrage</h1>\n```' })
    ) as { content: string }
    render(persisted.content)
    expect(container.querySelector('[data-testid="chat-inline-html"]')?.innerHTML).toBe(
      '<h1>Après redémarrage</h1>'
    )
  })

  it('keeps an oversized html-render block explicit instead of degrading it to code', () => {
    const oversizedSource = `<img src="data:image/png;base64,${'a'.repeat(1_000_001)}">`
    render(`\`\`\`html-render\n${oversizedSource}\n\`\`\``)

    // La limite compte PLUS qu'avant : en rendu inline, ce document deviendrait des noeuds DOM de
    // l'application au lieu d'un contexte séparé. Il est annoncé comme refusé, et reste consultable.
    const refused = container.querySelector('[data-testid="chat-inline-html-too-large"]')
    expect(refused).not.toBeNull()
    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
    expect(refused?.querySelector('summary')?.textContent).toContain('au-delà de la limite')
    expect(refused?.querySelector('pre code')?.textContent).toContain('data:image/png')
  })

  it.each([
    '```html-render\n<b>LIVE</b>\n    ```',
    '```html-render\n<b>LIVE</b>\n\t```',
    '- ```html-render\n  <b>LIVE</b>\n      ```',
    '> ```html-render\n> <b>LIVE</b>\n>     ```'
  ])('keeps an html-render fence inert when CommonMark did not close it: %s', (source) => {
    render(source)
    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
    expect(container.querySelector('pre code')?.textContent).toContain('<b>LIVE</b>')
  })

  it('still activates a truly closed html-render fence containing a marker-like code line', () => {
    render('```html-render\n<b>LIVE</b>\n    ```\n```')
    expect(container.querySelector('[data-testid="chat-inline-html"]')?.textContent).toContain(
      'LIVE'
    )
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

  it.each([
    `~~~text\n${CLOSURE}\n~~~`,
    `    ${CLOSURE}`,
    `> \`\`\`text\n> ${CLOSURE}\n> \`\`\``,
    `- \`\`\`text\n  ${CLOSURE}\n  \`\`\``,
    `10. Preuve :\n    ~~~text\n    ${CLOSURE}\n    ~~~`
  ])(
    'renders every CommonMark code citation as code after successful hydration: %s',
    (citation) => {
      renderHydrated({
        content: 'projection',
        status: 'completed',
        parts: [
          {
            kind: 'action',
            name: 'orchestrate',
            ok: true,
            data: { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
          },
          { kind: 'text', text: citation }
        ]
      })

      expect(
        Array.from(container.querySelectorAll('pre code')).some((node) =>
          node.textContent?.includes(CLOSURE)
        )
      ).toBe(true)
      expect(textOutsideCode().match(/Clôture Autowin : gate validé/g)).toHaveLength(1)
    }
  )

  it.each(
    (['failed', 'interrupted', 'cancelled'] as const).flatMap((status) =>
      [
        `~~~text\n${CLOSURE}\n~~~`,
        `    ${CLOSURE}`,
        `> \`\`\`text\n> ${CLOSURE}\n> \`\`\``,
        `- \`\`\`text\n  ${CLOSURE}\n  \`\`\``
      ].map((citation) => [status, citation] as const)
    )
  )('never exposes a cited green closure as prose after %s hydration: %s', (status, citation) => {
    renderHydrated({
      content: 'projection',
      status,
      parts: [{ kind: 'text', text: `${citation}\n\nÉchec final : timeout.` }]
    })

    expect(
      Array.from(container.querySelectorAll('pre code')).some((node) =>
        node.textContent?.includes(CLOSURE)
      )
    ).toBe(true)
    expect(textOutsideCode()).not.toContain(CLOSURE)
    expect(textOutsideCode()).toContain('Échec final : timeout.')
  })

  it.each([
    '~~~text\n✅ Fait\n📍 Maintenant\n⏳ Reste à faire\n👉 Recommandé\n~~~',
    '    ✅ Fait\n    📍 Maintenant\n    ⏳ Reste à faire\n    👉 Recommandé'
  ])('does not frame final-summary labels contained in CommonMark code: %s', (source) => {
    render(source, true)
    expect(container.querySelector('.md-final-summary')).toBeNull()
  })

  it.each(['completed', 'failed', 'interrupted', 'cancelled'] as const)(
    'keeps action-separated fenced evidence aligned with the visible DOM for %s',
    (status) => {
      const delivered = status === 'completed'
      renderHydrated({
        content: 'projection',
        status,
        parts: [
          { kind: 'text', text: '~~~text' },
          {
            kind: 'action',
            name: 'orchestrate',
            ok: delivered,
            data: delivered
              ? { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
              : { error: 'timeout' }
          },
          { kind: 'text', text: `${CLOSURE}\n~~~\n\nÉchec final : timeout.` }
        ]
      })

      expect(
        Array.from(container.querySelectorAll('pre code')).some((node) =>
          node.textContent?.includes(CLOSURE)
        )
      ).toBe(true)
      expect(textOutsideCode().match(/Clôture Autowin : gate validé/g) ?? []).toHaveLength(
        delivered ? 1 : 0
      )
      expect(textOutsideCode()).toContain('Échec final : timeout.')
    }
  )

  it('does not frame final-summary labels when a fence crosses an action boundary', () => {
    renderHydrated(
      {
        content: 'projection',
        status: 'completed',
        parts: [
          { kind: 'text', text: '~~~text' },
          { kind: 'action', name: 'get_state', ok: true },
          {
            kind: 'text',
            text: '✅ Fait\n📍 Maintenant\n⏳ Reste à faire\n👉 Recommandé\n~~~'
          }
        ]
      },
      true
    )

    expect(container.querySelector('.md-final-summary')).toBeNull()
    expect(
      Array.from(container.querySelectorAll('pre code')).some((node) =>
        node.textContent?.includes('✅ Fait')
      )
    ).toBe(true)
  })

  it.each(['completed', 'failed', 'interrupted', 'cancelled'] as const)(
    'keeps an html-render closure citation inert across an action for %s',
    (status) => {
      const delivered = status === 'completed'
      renderHydrated({
        content: 'projection',
        status,
        parts: [
          { kind: 'text', text: '```html-render' },
          {
            kind: 'action',
            name: 'orchestrate',
            ok: delivered,
            data: delivered
              ? { status: 'succeeded', valid: true, gateBlocked: false, reused: false }
              : { error: 'timeout' }
          },
          { kind: 'text', text: `<p>${CLOSURE}</p>\n\`\`\`\n\nÉchec final : timeout.` }
        ]
      })

      expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
      expect(
        Array.from(container.querySelectorAll('pre code')).some((node) =>
          node.textContent?.includes(CLOSURE)
        )
      ).toBe(true)
      expect(textOutsideCode().match(/Clôture Autowin : gate validé/g) ?? []).toHaveLength(
        delivered ? 1 : 0
      )
    }
  )

  it('keeps an html-render payload split by an action inert', () => {
    renderHydrated({
      content: 'projection',
      status: 'completed',
      parts: [
        { kind: 'text', text: '```html-render\n<section><b>' },
        { kind: 'action', name: 'verify', ok: true },
        { kind: 'text', text: 'LIVE</b></section>\n```' }
      ]
    })

    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
    expect(container.textContent).toContain('LIVE')
  })

  it('keeps every html-render fragment inert across action and artifact cards', () => {
    renderHydrated({
      content: 'projection',
      status: 'completed',
      parts: [
        { kind: 'text', text: '```html-render\n<section>' },
        { kind: 'action', name: 'verify', ok: true },
        { kind: 'text', text: '<b>LIVE' },
        {
          kind: 'artifact',
          artifact: {
            id: 'artifact-proof',
            name: 'proof.txt',
            mimeType: 'text/plain',
            kind: 'text',
            size: 5,
            createdAt: 1,
            encoding: 'utf8',
            content: 'proof',
            source: { provider: 'test' }
          }
        },
        { kind: 'text', text: '</b></section>\n```' }
      ]
    })

    expect(container.querySelector('[data-testid="chat-inline-html"]')).toBeNull()
    expect(container.textContent).toContain('LIVE')
  })
})

describe('extractRecommendation — ghost-text du composer', () => {
  it('extrait la reco avec libellé en gras et deux-points', () => {
    const txt =
      'blabla\n\n✅ Fait\n📍 Maintenant : x\n⏳ Reste : y\n👉 **Recommandé** : relance le build'
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
