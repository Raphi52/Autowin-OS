// @vitest-environment happy-dom
/**
 * conv-717 (2026-09-19) : « quand j'ai écrit fais tout ça a effacé ton message précédent ».
 * Au rechargement, la réponse à une consigne écrite pendant un tour remontait AU-DESSUS de la
 * consigne (même message assistant). Elle doit se relire SOUS elle.
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

describe('ChatView — fil relu avec une consigne écrite pendant un tour', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    localStorage.clear()
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('la réponse à la consigne s’affiche SOUS la consigne', async () => {
    const fil = conversation('A', [
      { role: 'user', content: 'liste 100 inconvenients', messageId: 'm1' },
      {
        role: 'assistant',
        messageId: 'm2',
        status: 'completed',
        content: 'VOICI-LA-LISTE LES-ONZE-FACILES',
        parts: [
          { kind: 'text', streamId: '0:0', text: 'VOICI-LA-LISTE' },
          { kind: 'text', streamId: '2:0', text: 'LES-ONZE-FACILES' }
        ]
      },
      {
        role: 'user',
        content: 'QUOI-ELIMINER',
        messageId: 'm3',
        orientation: true,
        coupeLaReponse: 1
      }
    ])
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([fil]),
        conversation: vi.fn().mockResolvedValue(fil)
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const texte = h.container.textContent ?? ''
    const liste = texte.indexOf('VOICI-LA-LISTE')
    const question = texte.indexOf('QUOI-ELIMINER')
    const reponse = texte.indexOf('LES-ONZE-FACILES')
    expect(liste).toBeGreaterThanOrEqual(0)
    expect(question).toBeGreaterThan(liste)
    expect(reponse).toBeGreaterThan(question)
    expect(texte.indexOf('LES-ONZE-FACILES', reponse + 1)).toBe(-1)
  })
})
