// @vitest-environment happy-dom
/**
 * REJEU du journal de tour : la déduplication comparait `JSON.stringify(message)` aux 80 premiers
 * caractères du texte rejoué. Coûteux ET faux dans les deux sens — deux tours au préambule
 * identique se masquaient l'un l'autre. La clé de dédup est désormais le TOUR (`turnId`).
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const PREAMBULE = 'Voici le résultat détaillé de la vérification demandée sur le dépôt courant, '

async function openWithTurn(turnId: string): Promise<void> {
  await act(async () => {
    window.dispatchEvent(
      new CustomEvent('autowin:open-conversation', { detail: { conversationId: 'A', turnId } })
    )
    await new Promise((r) => setTimeout(r, 10))
  })
}

describe('ChatView — rejeu du journal de tour', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('rejoue DEUX tours distincts au préambule identique', async () => {
    const turnJournal = vi.fn(async (_id: string, turnId: string) => [
      { kind: 'delta', text: `${PREAMBULE}tour ${turnId}` }
    ])
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [])]),
        turnJournal
      })
    )
    await openWithTurn('t1')
    await openWithTurn('t2')
    expect(h.container.textContent).toContain('tour t1')
    expect(h.container.textContent).toContain('tour t2')
  })

  it('ne rejoue PAS deux fois le même tour', async () => {
    const turnJournal = vi.fn(async () => [{ kind: 'delta', text: `${PREAMBULE}unique` }])
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [])]),
        turnJournal
      })
    )
    await openWithTurn('t1')
    await openWithTurn('t1')
    const occurrences = (h.container.textContent ?? '').split('unique').length - 1
    expect(occurrences).toBe(1)
  })

  it('ne rejoue pas un tour DÉJÀ présent dans le fil persisté (même turnId)', async () => {
    const turnJournal = vi.fn(async () => [{ kind: 'delta', text: `${PREAMBULE}déjà là` }])
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([
          conversation('A', [
            { role: 'user', content: 'demande' },
            {
              role: 'assistant',
              // Texte REFORMULÉ à la persistance : l'ancienne comparaison textuelle le ratait.
              content: 'Résumé condensé de la vérification.',
              parts: [{ kind: 'text', text: 'Résumé condensé de la vérification.' }],
              status: 'completed',
              turnId: 't1'
            }
          ])
        ]),
        turnJournal
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await openWithTurn('t1')
    expect(h.container.textContent).not.toContain('déjà là')
  })
})
