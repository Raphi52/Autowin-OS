// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { Msg } from './chat-view-types'
import type { HarnessTraceEvent } from './harness-timeline-model'
import { RequestThread } from './RequestThread'

let sequence = 0
function ev(
  id: string,
  turnId: string,
  at: string,
  overrides: Partial<HarnessTraceEvent> = {}
): HarnessTraceEvent {
  sequence += 1
  return {
    id,
    conversationId: 'conv-a',
    turnId,
    timestamp: at,
    sequence,
    type: 'message',
    status: 'completed',
    channel: 'internal',
    actor: { id: 'orchestrator', kind: 'agent', label: 'orchestrator' },
    payloads: [],
    observation: { boundary: 'orchestration', fidelity: 'exact' },
    ...overrides
  }
}

/** Deux demandes terminées : une ancienne réussie, une récente en échec. */
function trace(): HarnessTraceEvent[] {
  return [
    ev('old-prompt', 'turn-old', '2026-10-12T07:00:00.000Z', {
      provider: { id: 'claude', model: 'claude-opus-5-5' },
      payloads: [{ kind: 'user-message', content: 'UTILISATEUR: ajoute un module' }]
    }),
    ev('old-resp', 'turn-old', '2026-10-12T07:00:30.000Z', {
      type: 'model-response',
      parentId: 'old-prompt',
      metrics: { durationMs: 30000 }
    }),
    ev('old-ask', 'turn-old', '2026-10-12T07:00:31.000Z', {
      type: 'tool-call',
      parentId: 'old-prompt',
      actor: { id: 'orchestrator', kind: 'agent', label: 'Orchestrateur' },
      payloads: [{ kind: 'tool-call', name: 'ask', content: 'ARGUMENTS PRIVÉS' }]
    }),
    ev('old-bilan', 'turn-old', '2026-10-12T07:00:32.000Z', {
      type: 'boundary',
      actor: { id: 'execution-supervisor', kind: 'system', label: 'Execution supervisor' },
      metrics: { durationMs: 32000, costUsd: 0.42 }
    }),
    ev('new-prompt', 'turn-new', '2026-10-12T08:00:00.000Z', {
      provider: { id: 'claude', model: 'claude-opus-5-5' },
      payloads: [{ kind: 'user-message', content: 'UTILISATEUR: trie mes mails' }]
    }),
    ev('new-err', 'turn-new', '2026-10-12T08:00:03.000Z', {
      type: 'error',
      status: 'failed',
      parentId: 'new-prompt',
      metrics: { durationMs: 2800 },
      payloads: [{ kind: 'error', content: 'quota du modèle atteint' }]
    })
  ]
}

describe('RequestThread — le fil des demandes', () => {
  let container: HTMLDivElement | null = null
  let root: Root | null = null

  beforeAll(() => {
    ;(
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    act(() => root?.unmount())
    container?.remove()
    container = null
    root = null
    vi.useRealTimers()
  })

  async function render(props: { live?: boolean; messages?: Msg[] } = {}, events = trace()) {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        causalTrace: vi.fn().mockResolvedValue(events),
        // Résumé que l'app calcule depuis les journaux des demandes (`runs:turnJournalGestes`).
        turnJournalGestes: vi.fn().mockResolvedValue({
          'turn-old': {
            Read: { nombre: 2, echecs: 0, dureeMs: 3000 },
            Bash: { nombre: 3, echecs: 1, dureeMs: 9000 },
            Edit: { nombre: 1, echecs: 0, dureeMs: 400 }
          }
        }),
        // Plus jamais relu ligne par ligne depuis l'écran : le test le vérifie.
        turnJournal: vi.fn().mockResolvedValue([])
      }
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(
        createElement(RequestThread, { conversationId: 'conv-a', active: true, ...props })
      )
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  const rows = (view: HTMLElement) =>
    [...view.querySelectorAll<HTMLElement>('[data-request-row]')].map((row) => [
      row.getAttribute('data-request-row'),
      row.getAttribute('data-status')
    ])

  it('liste toutes les demandes, la plus récente en tête, avec état, durée et coût', async () => {
    const view = await render()

    expect(rows(view)).toEqual([
      ['turn-new', 'failed'],
      ['turn-old', 'completed']
    ])
    const old = view.querySelector('[data-request-row="turn-old"] .request-row')
    expect(old?.textContent).toContain('ajoute un module')
    expect(old?.textContent).toContain('terminé')
    expect(old?.textContent).toContain('32 s')
    expect(old?.textContent).toContain('0,42 $')
    expect(view.textContent).not.toContain('ARGUMENTS PRIVÉS')
  })

  it('chaque ligne compte les gestes propres de l’agent, en un seul appel pour tout le fil', async () => {
    const view = await render()
    const mini = view.querySelector<HTMLElement>('[data-request-row="turn-old"] .request-row-mini')

    // Lu ×2 (lectures), Modifié ×1 (édition), Lancé ×3 (commandes), Question ×1 (commande d'Autowin).
    expect(mini?.textContent).toContain('Lu ×2 · Modifié ×1 · Lancé ×3 · Question ×1')
    // Un morceau insécable par élément : la ligne ne se brise qu'ENTRE deux morceaux, jamais au
    // milieu de « Lancé ×3 » (panneau étroit, résumé sur deux lignes).
    expect(
      [...(mini?.querySelectorAll('.request-row-piece') ?? [])].map((piece) => piece.textContent)
    ).toEqual([
      '12/10/2026 09:00',
      'Lu ×2',
      'Modifié ×1',
      'Lancé ×3',
      'Question ×1',
      'Question posée : il attend ta réponse'
    ])
    expect(mini?.getAttribute('data-native-gestures')).toBe('6')
    expect(mini?.title).toBe('Dont 6 gestes de l’agent (lectures, commandes, éditions)')
    // La demande sans journal ne s'invente aucun geste.
    expect(
      view
        .querySelector('[data-request-row="turn-new"] .request-row-mini')
        ?.getAttribute('data-native-gestures')
    ).toBe('0')
    expect(window.api.turnJournalGestes).toHaveBeenCalledTimes(1)
    expect(window.api.turnJournalGestes).toHaveBeenCalledWith('conv-a')
    expect(window.api.turnJournal).not.toHaveBeenCalled()
  })

  it('ouvre la plus récente en récit : cause d’échec en tête et cinq chapitres', async () => {
    const view = await render()
    const story = view.querySelector('[data-request-story="turn-new"]')

    expect(story?.querySelector('[data-request-failure]')?.textContent).toBe(
      'quota du modèle atteint'
    )
    expect([...(story?.querySelectorAll('dt') ?? [])].map((dt) => dt.textContent)).toEqual([
      'Demande',
      'Décision',
      'Ce qu’il a fait',
      'Résultat',
      'Bilan'
    ])
    expect(view.querySelector('[data-request-story="turn-old"]')).toBeNull()
  })

  it('un clic raconte une autre demande, avec les gestes propres de l’agent du résumé', async () => {
    const view = await render()
    await act(async () => {
      view.querySelector<HTMLButtonElement>('[data-request-row="turn-old"] .request-row')?.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    const story = view.querySelector('[data-request-story="turn-old"]')
    expect(view.querySelector('[data-request-story="turn-new"]')).toBeNull()
    expect(story?.querySelector('[data-family="lire"]')?.textContent).toContain('Fichier lu ×2')
    expect(story?.querySelector('[data-family="lancer"]')?.textContent).toContain(
      'Commande ×3'
    )
    expect(
      story?.querySelector('[data-family="lancer"] .request-story-action.is-failed')
    ).not.toBeNull()
    expect(story?.querySelector('[data-family="demander"]')?.textContent).toContain(
      'Question posée'
    )
    // Ouvrir un récit ne relit aucun journal : le résumé chargé avec le fil suffit.
    expect(window.api.turnJournal).not.toHaveBeenCalled()
  })

  it('en direct, la demande en cours vient du flux du chat et masque sa trace partielle', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(Date.parse('2026-10-12T08:02:00.000Z'))
    const messages = [
      { role: 'user', content: 'trie mes mails', ts: Date.parse('2026-10-12T07:59:58.000Z') },
      {
        role: 'assistant',
        turnId: 'turn-new',
        parts: [{ kind: 'action', name: 'verify', progress: '5 s · > npm test' }],
        status: 'streaming',
        done: false
      }
    ] as unknown as Msg[]
    const view = await render({ live: true, messages })

    expect(rows(view)).toEqual([
      ['demande-en-cours', 'running'],
      ['turn-old', 'completed']
    ])
    const live = view.querySelector('[data-request-row="demande-en-cours"] .request-row')
    expect(live?.textContent).toContain('trie mes mails')
    expect(live?.textContent).toContain('2 min 02 s')
    expect(live?.textContent).toContain('5 s · > npm test')
  })

  it('sans conversation, le dit au lieu d’un fil vide', async () => {
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => root?.render(createElement(RequestThread, {})))
    expect(container.textContent).toContain('Sélectionne une conversation')
  })
})
