// @vitest-environment happy-dom
/**
 * « MON MESSAGE S'AFFICHE EN DESSOUS DE LA REPONSE QUI LE PREND EN COMPTE » (2026-09-04, capture).
 *
 * Une consigne tapee PENDANT un tour est ecrite en fin de fil (ordre chronologique assume). Mais la
 * suite du texte de l'agent continuait d'atterrir dans la bulle OUVERTE situee au-DESSUS d'elle :
 * l'utilisateur lisait la reponse a sa demande AVANT sa demande. La suite doit s'ecrire dans une
 * NOUVELLE bulle, sous la consigne.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

describe('ChatView — consigne tapee pendant un tour', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('la suite du texte s’ecrit SOUS la consigne, pas dans la bulle du dessus', async () => {
    let pilote!: (event: Record<string, unknown>) => void
    let appEvent!: (event: Record<string, unknown>) => void
    let avecConsigne = false
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversation: vi.fn(async () => ({
          id: 'A',
          title: 'A',
          messages: [
            { role: 'user', content: 'commite le chantier', messageId: 'm1' },
            ...(avecConsigne
              ? [
                  { role: 'assistant', content: 'je commite.', messageId: 'm2' },
                  { role: 'user', content: 'decale de 1px', messageId: 'm3', orientation: true }
                ]
              : [])
          ]
        })),
        pilotChat: vi.fn(() => new Promise(() => {})),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        }),
        onAppEvent: vi.fn((listener) => {
          appEvent = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await h.click('.conv-pick')
    await h.type('commite le chantier')
    await h.click('.composer-send')
    await act(async () =>
      pilote({ conversationId: 'A', kind: 'delta', text: 'je commite.', streamId: 's1' })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    // La consigne tapee pendant le tour est ecrite par le main, en fin de fil.
    avecConsigne = true
    await act(async () => appEvent({ type: 'refresh', scope: 'chat', convId: 'A' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    await act(async () =>
      pilote({ conversationId: 'A', kind: 'delta', text: 'Directive prise', streamId: 's1' })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const texte = h.container.textContent ?? ''
    expect(texte).toContain('decale de 1px')
    expect(texte).toContain('Directive prise')
    expect(texte.indexOf('decale de 1px')).toBeLessThan(texte.indexOf('Directive prise'))
  })
})
