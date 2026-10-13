// @vitest-environment happy-dom
/**
 * « RÉPONSE AFFICHÉE » N'ENREGISTRE PLUS UN DÉBUT DE RÉPONSE QUAND LA VUE A ÉTÉ REMONTÉE.
 *
 * Mesuré le 2026-10-12 : 12 « Réponse affichée » sur 50 ne gardaient qu'un début (conv-912 : 185
 * caractères sur 5 053), et conv-910 et conv-912 s'étaient figées à la même seconde. L'envoi lisait,
 * en fin de tour, la copie du fil de la vue qui l'avait lancé ; remontée entre-temps (rechargement
 * à chaud en développement), cette vue ne recevait plus rien. La vue montée, elle, avait tout reçu.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const harnais: ChatHarness[] = []
beforeAll(() => installRafShim())
afterEach(async () => {
  for (const h of harnais.splice(0)) await h.unmount()
})

const frames = async (): Promise<void> => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0))
}

describe('Réponse affichée — vue remontée pendant le tour', () => {
  it('enregistre la réponse ENTIÈRE reçue par la vue montée, pas le début gardé par l’ancienne', async () => {
    let finDuTour!: (value: { ok: boolean }) => void
    const abonnes: Array<(event: unknown) => void> = []
    let stocke: unknown[] = []
    const api = chatApi({
      onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
        abonnes.push(cb)
        return vi.fn()
      }),
      conversation: vi.fn(async () => ({ id: 'A', title: 'A', messages: stocke, updatedAt: 1 })),
      pilotChat: vi.fn(
        () =>
          new Promise<{ ok: boolean }>((resolve) => {
            finDuTour = resolve
          })
      )
    })

    const premiere = await mountChat(api)
    harnais.push(premiere)
    await premiere.type('bonjour')
    await premiere.click('.composer-send')
    await act(async () => {
      abonnes.at(-1)?.({ conversationId: 'A', kind: 'delta', text: 'Début. ', streamId: 's' })
      await frames()
    })

    // La vue est REMONTÉE en plein tour : la nouvelle relit le fil stocké, puis reçoit la suite.
    stocke = [
      { role: 'user', content: 'bonjour' },
      {
        role: 'assistant',
        content: 'Début. ',
        parts: [{ kind: 'text', text: 'Début. ' }],
        status: 'streaming'
      }
    ]
    await premiere.unmount()
    harnais.splice(0)
    const seconde = await mountChat(api)
    harnais.push(seconde)
    await act(async () => {
      await frames()
      abonnes.at(-1)?.({
        conversationId: 'A',
        kind: 'delta',
        text: 'Suite complète.',
        streamId: 's2'
      })
      abonnes.at(-1)?.({ conversationId: 'A', kind: 'done' })
      await frames()
    })

    await act(async () => {
      finDuTour({ ok: true })
      await frames()
    })

    expect(api.markResponseDisplayed).toHaveBeenCalledTimes(1)
    const [conversationId, texte] = (api.markResponseDisplayed as ReturnType<typeof vi.fn>).mock
      .calls[0]
    expect(conversationId).toBe('A')
    // Ce qui est enregistré est ce que la vue MONTÉE affiche, suite comprise. L’ancienne vue, elle,
    // ne gardait que « Début. » : c’est exactement ce qui était écrit avant le correctif.
    expect(texte).toContain('Suite complète.')
    expect(seconde.container.textContent).toContain(String(texte).trim())
  })
})
