// @vitest-environment happy-dom
/**
 * LE FIL D'UN LOT REPRIS APRÈS UN REDÉMARRAGE NE DOIT PAS PARAÎTRE FIGÉ (conv-1330, 2026-10-30).
 *
 * Vécu : conv-1324, lot 3 d'une super conv. L'app a redémarré à 14:44 ; le main a rattaché le
 * travail, posé un récapitulatif « Reprise du fil » SOUS la bulle du tour, puis relancé une
 * construction à 14:52. Jusqu'à 15:27 au moins, l'agent travaillait (spinner allumé) et rien ne
 * bougeait dans le fil. Un tour de chat normal pose sa note d'activité (« Bash en cours — 2 min »)
 * dans la bulle par le battement du pilote (`action-progress`) ; une reprise n'a pas de tour de
 * chat, sa note n'arrive que par `orchestrate-delta` — et n'allait qu'au panneau des workflows.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST : une note qui ne s'affiche pas dans la bulle de
 * l'orchestration ouverte, une note posée dans le récapitulatif du dessous, ou une note qui passe
 * le fil en « occupé » (la sonde `pilotChatActive` le déclarerait mort 8 s plus tard).
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const TOUR = '42b904ae-202c-4e9e-b73c-f31c5e0917c4'

describe('ChatView — note d’activité d’un run repris sans tour de chat', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('pose la note dans la bulle de l’orchestration ouverte, sans passer le fil en occupé', async () => {
    const abonnes = new Set<(event: Record<string, unknown>) => void>()
    const appEvent = (event: Record<string, unknown>): void => {
      for (const abonne of [...abonnes]) abonne(event)
    }
    h = await mountChat(
      chatApi({
        // Résumé SANS `messages` (comme `listSummaries`) : le fil se lit alors par `conversation`.
        conversations: vi
          .fn()
          .mockResolvedValue([
            { id: 'A', title: 'Conversation A', category: 'codex', provider: 'codex', updatedAt: 3 }
          ]),
        conversation: vi.fn(async () => ({
          id: 'A',
          title: 'A',
          messages: [
            { role: 'user', content: '/build Lot 3/3', messageId: 'm1' },
            {
              role: 'assistant',
              content: '',
              messageId: 'm2',
              turnId: TOUR,
              status: 'streaming',
              parts: [
                {
                  kind: 'action',
                  actionId: 'route:0',
                  name: 'orchestrate',
                  args: { task: 'lot 3' }
                }
              ]
            },
            {
              role: 'assistant',
              content: 'Reprise du fil — l’agent a continué de travailler.',
              messageId: 'm3',
              repriseDuChantier: 'run-7b7d533c318e-1'
            }
          ]
        })),
        // Aucun tour de CHAT ne tourne : c'est une orchestration reprise par le main.
        pilotChatActive: vi.fn(async () => ({ active: false })),
        onAppEvent: vi.fn((listener) => {
          abonnes.add(listener as (event: Record<string, unknown>) => void)
          return () => abonnes.delete(listener as (event: Record<string, unknown>) => void)
        })
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => {
      appEvent({ type: 'orchestrate-start', convId: 'A', task: 'lot 3' })
      appEvent({
        type: 'orchestrate-delta',
        convId: 'A',
        deltaStep: 'exec',
        delta: '',
        note: 'Bash en cours — 2 min · npx vitest run src/main/navigateur-integre.test.ts'
      })
    })
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const bulles = [...h.container.querySelectorAll('.msg.assistant')]
    expect(bulles).toHaveLength(2)
    // La note est dans la bulle du travail en cours…
    expect(bulles[0].textContent).toContain('npx vitest run src/main/navigateur-integre.test.ts')
    // … pas dans le récapitulatif du dessous.
    expect(bulles[1].textContent).not.toContain('npx vitest run')
    // Et le fil n'est pas pris pour un tour de chat en cours.
    expect(
      h.container
        .querySelector('.chat-runtime-etat [data-conversation-state]')
        ?.getAttribute('data-conversation-state')
    ).not.toBe('running')
  })
})
