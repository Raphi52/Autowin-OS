// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ConversationCostIndicator } from './ConversationCostIndicator'

/**
 * « Je navigue de conv en conv et ça écrit le même coût » (utilisateur, 2026-09-21).
 *
 * Le serveur rend bien un total PAR conversation (vérifié sur 10 fils réels du même dossier :
 * 402 $, 478 $, 385 $, 1,18 $…). Le défaut est dans la pastille : elle garde le total d'un autre
 * fil. Ces tests rejouent la navigation, y compris vers un fil OCCUPÉ (mode auto, tour en cours) —
 * c'est le cas du quotidien sur un dossier où plusieurs fils tournent en même temps.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

const flush = (): Promise<void> =>
  act(async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve()
  })

function ligne(costUsd: number): Record<string, unknown> {
  return {
    key: 'orchestrator',
    calls: 1,
    costUsd,
    inputTokens: 10,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheHitRatio: 0,
    unpricedCalls: 0
  }
}

const COUTS: Record<string, number> = { 'conv-A': 402.32, 'conv-B': 1.18, 'conv-C': 73.4 }

function installerApi(retarder: (id: string) => Promise<void> = async () => {}): void {
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = {
    costBreakdown: async (_dimension: string, id?: string) => {
      await retarder(id ?? '')
      return [ligne(COUTS[id ?? ''] ?? 0)]
    },
    promptCalls: async () => []
  }
}

async function afficher(props: { conversationId?: string; busy?: boolean }): Promise<void> {
  await act(async () => {
    root.render(createElement(ConversationCostIndicator, props))
  })
  await flush()
}

function libelle(): string | null | undefined {
  return container.querySelector('[data-testid="conversation-cost-total"]')?.textContent
}

function monter(): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
}

describe('pastille de coût — elle suit la conversation affichée', () => {
  it('change de total quand on passe d’un fil libre à un autre', async () => {
    installerApi()
    monter()
    await afficher({ conversationId: 'conv-A', busy: false })
    expect(libelle()).toContain('402,32')
    await afficher({ conversationId: 'conv-B', busy: false })
    expect(libelle()).toContain('1,18')
  })

  it('affiche le total du fil d’arrivée même s’il est OCCUPÉ (tour en cours)', async () => {
    installerApi()
    monter()
    await afficher({ conversationId: 'conv-A', busy: false })
    expect(libelle()).toContain('402,32')
    // Le fil d'arrivée travaille : la pastille ne doit PAS garder le total de conv-A.
    await afficher({ conversationId: 'conv-C', busy: true })
    expect(libelle()).toContain('73,40')
  })

  it('ne se laisse pas écraser par la réponse TARDIVE du fil qu’on vient de quitter', async () => {
    const enAttente = new Map<string, () => void>()
    installerApi(
      (id) =>
        new Promise<void>((resolve) => {
          enAttente.set(id, resolve)
        })
    )
    monter()
    await afficher({ conversationId: 'conv-A', busy: false })
    await afficher({ conversationId: 'conv-B', busy: false })
    // conv-B répond d'abord, puis la réponse LENTE de conv-A arrive.
    await act(async () => enAttente.get('conv-B')?.())
    await flush()
    await act(async () => enAttente.get('conv-A')?.())
    await flush()
    expect(libelle()).toContain('1,18')
  })

  it('n’affiche jamais le total d’un autre fil pendant le chargement', async () => {
    const enAttente = new Map<string, () => void>()
    installerApi((id) =>
      id === 'conv-A'
        ? Promise.resolve()
        : new Promise<void>((resolve) => {
            enAttente.set(id, resolve)
          })
    )
    monter()
    await afficher({ conversationId: 'conv-A', busy: false })
    expect(libelle()).toContain('402,32')
    await afficher({ conversationId: 'conv-B', busy: false })
    // Tant que conv-B n'a pas répondu, le chiffre de conv-A ne doit plus être à l'écran.
    expect(libelle() ?? '').not.toContain('402,32')
  })
})
