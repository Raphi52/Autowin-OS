// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationCostIndicator } from './ConversationCostIndicator'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

interface Api {
  costBreakdown?: (dimension: string, conversationId?: string) => Promise<unknown>
}

function setApi(api: Api): { calls: Array<[string, string | undefined]> } {
  const calls: Array<[string, string | undefined]> = []
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    costBreakdown: async (dimension: string, conversationId?: string) => {
      calls.push([dimension, conversationId])
      return api.costBreakdown ? await api.costBreakdown(dimension, conversationId) : []
    }
  }
  return { calls }
}

async function render(props: { conversationId?: string; busy?: boolean }): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root.render(createElement(ConversationCostIndicator, props))
  })
  await flush()
}

const rows = [
  {
    key: 'subagent',
    calls: 18,
    costUsd: 10.05,
    inputTokens: 900_000,
    outputTokens: 5000,
    cacheReadTokens: 0,
    cacheHitRatio: 0,
    unpricedCalls: 0
  },
  {
    key: 'orchestrator',
    calls: 12,
    costUsd: 0.86,
    inputTokens: 42_000,
    outputTokens: 900,
    cacheReadTokens: 40_000,
    cacheHitRatio: 0.95,
    unpricedCalls: 0
  }
]

describe('ConversationCostIndicator — la dépense est à l’écran', () => {
  it('affiche le total de la conversation', async () => {
    setApi({ costBreakdown: async () => rows })
    await render({ conversationId: 'conv-76' })
    expect(
      container.querySelector('[data-testid="conversation-cost-total"]')?.textContent
    ).toContain('10,91 $')
  })

  it('interroge le canal pour LA conversation affichée, dimension acteur', async () => {
    const { calls } = setApi({ costBreakdown: async () => rows })
    await render({ conversationId: 'conv-76' })
    expect(calls).toEqual([['actor', 'conv-76']])
  })

  it('keeps an unpriced provider call visible', async () => {
    setApi({
      costBreakdown: async () => [
        {
          key: 'codex',
          calls: 1,
          costUsd: 0,
          inputTokens: 100,
          outputTokens: 20,
          cacheReadTokens: 0,
          cacheHitRatio: 0,
          unpricedCalls: 1
        }
      ]
    })
    await render({ conversationId: 'conv-unpriced' })
    expect(
      container.querySelector('[data-testid="conversation-cost-total"]')?.textContent
    ).toContain('non expos')
  })

  it('rien dépensé → l’indicateur ne s’affiche PAS (aucun faux « 0 $ »)', async () => {
    setApi({ costBreakdown: async () => [] })
    await render({ conversationId: 'conv-76' })
    expect(container.querySelector('[data-testid="conversation-cost"]')).toBeNull()
  })

  it('un tour EN COURS n’interroge pas le journal (la dépense n’y est pas encore)', async () => {
    const { calls } = setApi({ costBreakdown: async () => rows })
    await render({ conversationId: 'conv-76', busy: true })
    expect(calls).toEqual([])
  })

  it('le clic déplie le détail par acteur, trié par coût', async () => {
    setApi({ costBreakdown: async () => rows })
    await render({ conversationId: 'conv-76' })
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="conversation-cost-total"]')?.click()
    )
    await flush()
    const keys = [...container.querySelectorAll('.conv-cost-key')].map((n) => n.textContent)
    expect(keys).toEqual(['subagent', 'orchestrator'])
  })

  it('un contexte RÉÉCRIT est signalé — c’est ce qui fait grimper la facture', async () => {
    setApi({ costBreakdown: async () => rows })
    await render({ conversationId: 'conv-76' })
    const total = container.querySelector('[data-testid="conversation-cost-total"]')
    expect(total?.className).toContain('warn')
    await act(async () => (total as HTMLButtonElement)?.click())
    await flush()
    expect(
      container.querySelector('[data-testid="conversation-cost-warning"]')?.textContent
    ).toContain('réécrit')
  })

  it('un bon cache n’affiche AUCUNE alerte', async () => {
    setApi({
      costBreakdown: async () => [
        {
          key: 'orchestrator',
          calls: 20,
          costUsd: 2,
          inputTokens: 100_000,
          outputTokens: 900,
          cacheReadTokens: 90_000,
          cacheHitRatio: 0.9,
          unpricedCalls: 0
        }
      ]
    })
    await render({ conversationId: 'conv-76' })
    expect(
      container.querySelector('[data-testid="conversation-cost-total"]')?.className
    ).not.toContain('warn')
  })

  it('un canal qui JETTE ne casse pas le composeur', async () => {
    setApi({
      costBreakdown: async () => {
        throw new Error('journal illisible')
      }
    })
    await render({ conversationId: 'conv-76' })
    expect(container.querySelector('[data-testid="conversation-cost"]')).toBeNull()
  })

  it('sans conversation active, aucun appel et aucun affichage', async () => {
    const { calls } = setApi({ costBreakdown: async () => rows })
    await render({})
    expect(calls).toEqual([])
    expect(container.querySelector('[data-testid="conversation-cost"]')).toBeNull()
  })

  it('canal absent (version ancienne) → aucun crash', async () => {
    ;(globalThis as unknown as { window: { api: unknown } }).window.api = {}
    await render({ conversationId: 'conv-76' })
    expect(container.querySelector('[data-testid="conversation-cost"]')).toBeNull()
  })
})
