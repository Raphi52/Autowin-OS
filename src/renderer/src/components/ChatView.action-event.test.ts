import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AssistantActionEvent } from './ChatView'

describe('AssistantActionEvent', () => {
  it('keeps a compact summary and inspectable input/result in semantic details', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantActionEvent, {
        part: {
          kind: 'action',
          name: 'navigate',
          args: { tab: 'memory' },
          ok: true,
          data: { activeTab: 'memory' }
        }
      })
    )

    expect(html).toContain('<details class="action-event">')
    expect(html).toContain('Navigation')
    expect(html).toContain('réussi')
    expect(html).toContain('Entrée')
    expect(html).toContain('Résultat')
    expect(html).toContain('activeTab')
  })

  it('makes failures explicit without hiding their details', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantActionEvent, {
        part: { kind: 'action', name: 'orchestrate', ok: false, data: { error: 'boom' } }
      })
    )

    expect(html).toContain('action-event failed')
    expect(html).toContain('échec')
    expect(html).toContain('boom')
  })
})
