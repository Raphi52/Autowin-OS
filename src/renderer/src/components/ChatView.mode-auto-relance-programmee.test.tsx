// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * conv-826 (2026-09-24) : « faudrait que le mode auto gère ce cas au lieu de s'arrêter ». Une suite
 * qui ne peut partir qu'à un moment précis (« dans 20 min ») est PROGRAMMÉE, puis envoyée seule.
 * Le délai réel (20 min) est raccourci ici : seuls les minuteurs longs (≥ 60 s) sont accélérés.
 */
const cloture = (suite: string): string =>
  ['✅ Fait', '1. Le tournoi tourne.', `👉 Recommandé : ${suite}`].join('\n')
const SUITE = 'relever les résultats du tournoi dans 20 min.'

function accelererLesLongsMinuteurs(): void {
  const vrai = window.setTimeout.bind(window)
  vi.spyOn(window, 'setTimeout').mockImplementation(((fn: () => void, ms?: number) =>
    vrai(fn, (ms ?? 0) >= 60_000 ? 150 : ms)) as typeof window.setTimeout)
}
const attendre = (ms: number): Promise<void> =>
  act(async () => {
    await new Promise((r) => setTimeout(r, ms))
  })
const envoisDe = (pilotChat: ReturnType<typeof vi.fn>, depuis: number): number =>
  pilotChat.mock.calls.slice(depuis).filter((c) => JSON.stringify(c).includes(SUITE)).length

describe('ChatView — une suite différée est programmée, pas abandonnée', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  async function monter(): Promise<{
    pilotChat: ReturnType<typeof vi.fn>
    pilote: (e: Record<string, unknown>) => void
  }> {
    const base = [{ role: 'user', content: 'salut' }, { role: 'assistant', content: cloture('lancer terrain.') }]
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    let pilote!: (event: Record<string, unknown>) => void
    h = await mountChat(
      chatApi({
        pilotChat,
        conversations: vi.fn().mockResolvedValue([conversation('A', base), conversation('B', base)]),
        conversation: vi.fn(async (id: string) => conversation(id, base)),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { pilotChat, pilote: (e) => pilote(e) }
  }
  const terminer = async (
    pilote: (e: Record<string, unknown>) => void,
    id: string
  ): Promise<void> => {
    await act(async () =>
      pilote({ conversationId: id, kind: 'delta', text: cloture(SUITE), streamId: 's1' })
    )
    await act(async () => pilote({ conversationId: id, kind: 'done' }))
  }

  it('fil affiché : annonce l’attente, puis envoie la suite UNE seule fois à l’échéance', async () => {
    const { pilotChat, pilote } = await monter()
    await h!.click('.conv-item .conv-pick')
    await h!.click('[data-testid="composer-auto-toggle"]')
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await terminer(pilote, 'A')
    await attendre(5)
    expect(envoisDe(pilotChat, avant)).toBe(0)
    expect(h!.container.textContent).toContain('Je la relance seul')
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(1)
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(1)
  })

  it('la relance programmée survit à un changement de conversation', async () => {
    const { pilotChat, pilote } = await monter()
    const items = () => document.querySelectorAll<HTMLElement>('.conv-item .conv-pick')
    await act(async () => items()[1].click())
    await h!.click('[data-testid="composer-auto-toggle"]')
    await act(async () => items()[0].click())
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await terminer(pilote, 'B')
    await attendre(5)
    expect(envoisDe(pilotChat, avant)).toBe(0)
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(1)
    expect(JSON.stringify(pilotChat.mock.calls.at(-1))).toContain('"B"')
  })

  it('éteindre ∞ pendant l’attente annule la relance', async () => {
    const { pilotChat, pilote } = await monter()
    await h!.click('.conv-item .conv-pick')
    await h!.click('[data-testid="composer-auto-toggle"]')
    await attendre(20)
    accelererLesLongsMinuteurs()
    const avant = pilotChat.mock.calls.length
    await terminer(pilote, 'A')
    await attendre(5)
    await h!.click('[data-testid="composer-auto-toggle"]')
    await attendre(500)
    expect(envoisDe(pilotChat, avant)).toBe(0)
  })
})
