import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { AssistantActionEvent, AssistantActivityGroup } from './ChatView'

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

describe('AssistantActivityGroup', () => {
  it('collapses consecutive actions behind a compact inspectable summary', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantActivityGroup, {
        actions: [
          { kind: 'action', name: 'navigate', args: { tab: 'memory' }, ok: true },
          { kind: 'action', name: 'get_state', ok: false, data: { error: 'boom' } }
        ]
      })
    )

    expect(html).toContain('<details class="activity-group failed">')
    expect(html).toContain('2 actions avec erreur')
    expect(html).toContain('Navigation · Lecture d’état')
    expect(html.match(/class="action-event/g)).toHaveLength(2)
    expect(html).toContain('Entrée')
    expect(html).toContain('Résultat')
  })
})
