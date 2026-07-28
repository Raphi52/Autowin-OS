import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../../../shared/chat-turn'
import { AssistantActionEvent, AssistantActivityGroup } from './ChatView.parts'
import { hydrateStoredAssistant, reduceAssistantPilotEvent } from './chat-view-model'

function renderActivity(events: ChatTurnEvent[]): string {
  const turn = events.reduce(reduceChatTurn, createChatTurn('turn-actions'))
  const actions = turn.parts.filter((part) => part.kind === 'action')
  return renderToStaticMarkup(createElement(AssistantActivityGroup, { actions }))
}

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

  it('renders every resolved action as completed after a successful turn', () => {
    const html = renderActivity([
      { kind: 'command', actionId: 'navigate', name: 'navigate', args: { tab: 'memory' } },
      { kind: 'result', actionId: 'navigate', name: 'navigate', ok: true },
      { kind: 'command', actionId: 'state', name: 'get_state' },
      { kind: 'result', actionId: 'state', name: 'get_state', ok: true },
      { kind: 'done' }
    ])

    expect(html).toContain('2 actions terminées')
    expect(html.match(/réussi/g)).toHaveLength(2)
    expect(html).not.toContain('en cours')
  })

  it('keeps the pending action label visible while earlier actions are completed', () => {
    const html = renderActivity([
      { kind: 'command', actionId: 'navigate', name: 'navigate' },
      { kind: 'result', actionId: 'navigate', name: 'navigate', ok: true },
      { kind: 'command', actionId: 'state', name: 'get_state' }
    ])

    expect(html).toContain('1 action terminée · 1 action en cours')
    expect(html).toContain('Lecture d’état')
    expect(html).toContain('réussi')
    expect(html).toContain('en cours')
  })

  it('renders a pending action as failed when the turn fails before its result', () => {
    const html = renderActivity([
      { kind: 'command', actionId: 'orchestrate', name: 'orchestrate' },
      { kind: 'failed', error: 'annulation fournisseur' }
    ])

    expect(html).toContain('1 action avec erreur')
    expect(html).toContain('échec')
    expect(html).not.toContain('en cours')
  })
})

describe('réconciliation des actions jamais résolues', () => {
  it('un tour CLOS ne laisse aucune action « en cours » (bug de l’indicateur collé)', () => {
    const message = [
      { kind: 'command' as const, actionId: 'orch', name: 'orchestrate' },
      { kind: 'done' as const }
    ].reduce(
      (m, event) => reduceAssistantPilotEvent(m, event as never),
      hydrateStoredAssistant({ content: '', parts: [], status: 'streaming' })
    )
    const actions = message.parts.filter((part) => part.kind === 'action')

    expect(message.done).toBe(true)
    expect(actions[0]).toMatchObject({ interrupted: true })
    const html = renderToStaticMarkup(createElement(AssistantActivityGroup, { actions }))
    expect(html).not.toContain('en cours')
    expect(html).toContain('interrompue')
  })

  it('une conversation RECHARGÉE après fermeture ne montre plus d’action en cours', () => {
    const hydrated = hydrateStoredAssistant({
      content: '',
      status: 'completed',
      parts: [{ kind: 'action', actionId: 'orch', name: 'orchestrate' }]
    })
    const actions = hydrated.parts.filter((part) => part.kind === 'action')

    expect(actions[0]).toMatchObject({ interrupted: true })
    expect(renderToStaticMarkup(createElement(AssistantActivityGroup, { actions }))).not.toContain(
      'en cours'
    )
  })

  it('n’altère PAS une action réellement en cours (tour encore en streaming)', () => {
    const hydrated = hydrateStoredAssistant({
      content: '',
      status: 'streaming',
      parts: [{ kind: 'action', actionId: 'orch', name: 'orchestrate' }]
    })
    const actions = hydrated.parts.filter((part) => part.kind === 'action')

    expect(actions[0]).not.toHaveProperty('interrupted')
    expect(renderToStaticMarkup(createElement(AssistantActivityGroup, { actions }))).toContain(
      'en cours'
    )
  })
})
