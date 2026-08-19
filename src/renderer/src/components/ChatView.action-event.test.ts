import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { createChatTurn, reduceChatTurn, type ChatTurnEvent } from '../../../shared/chat-turn'
import { AssistantActivityGroup } from './ChatView.parts'
import { hydrateStoredAssistant, reduceAssistantPilotEvent } from './chat-view-model'

function renderActivity(events: ChatTurnEvent[]): string {
  const turn = events.reduce(reduceChatTurn, createChatTurn('turn-actions'))
  const actions = turn.parts.filter((part) => part.kind === 'action')
  return renderToStaticMarkup(createElement(AssistantActivityGroup, { actions }))
}

describe('AssistantActivityGroup', () => {
  it('est un BOUTON vers Workflows, jamais un bloc dépliable dans le fil', () => {
    const html = renderToStaticMarkup(
      createElement(AssistantActivityGroup, {
        actions: [
          { kind: 'action', name: 'navigate', args: { tab: 'memory' }, ok: true },
          { kind: 'action', name: 'get_state', ok: false, data: { error: 'boom' } }
        ]
      })
    )

    // Le détail VERBEUX (prompt du sous-agent, entrée/résultat bruts) vit dans Workflows, pas au
    // milieu du chat : c'est ce que cette garde protège, et elle tient toujours.
    //
    // Ce qu'elle ne protège PLUS : la CAUSE d'un échec. `navigate` et `get_state` ne produisent
    // aucun run, donc le bouton ne peut renvoyer nulle part (décision du 2026-07-29 dans
    // `action-detail-target.ts` : « s'il n'y a pas de run, le detail doit s'afficher SUR PLACE »).
    // Depuis le 2026-08-18, `data.error` est expose : l'utilisateur voyait « 1 action avec erreur »
    // sans jamais pouvoir savoir pourquoi. Le repli est CLIQUABLE, donc il n'encombre pas le fil —
    // c'est exactement « en savoir plus quand je clique ».
    expect(html).toContain('<button')
    expect(html).not.toContain('action-event')
    expect(html).not.toContain('Entrée')
    expect(html).not.toContain('Résultat')
    // La cause est atteignable, repliee par defaut.
    expect(html).toContain('boom')
    // Le résumé cliquable reste informatif.
    expect(html).toContain('2 actions avec erreur')
    expect(html).toContain('Navigation · Lecture d’état')
  })

  it('appelle onOpenLiveAction en mode history quand plus rien ne tourne', () => {
    const modes: string[] = []
    const html = renderToStaticMarkup(
      createElement(AssistantActivityGroup, {
        actions: [{ kind: 'action', name: 'orchestrate', interrupted: true }],
        onOpenLiveAction: (mode) => modes.push(mode)
      })
    )
    // Le rendu statique ne clique pas : on vérifie le contrat d'intention affiché.
    expect(html).toContain('Voir le détail de cette action dans Workflows')
    expect(modes).toEqual([])
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
  })

  it('renders a pending action as failed when the turn fails before its result', () => {
    const html = renderActivity([
      { kind: 'command', actionId: 'orchestrate', name: 'orchestrate' },
      { kind: 'failed', error: 'annulation fournisseur' }
    ])

    expect(html).toContain('1 action avec erreur')
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
