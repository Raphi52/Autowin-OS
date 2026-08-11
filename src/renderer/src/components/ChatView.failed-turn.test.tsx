// @vitest-environment happy-dom
/**
 * Un tour en `failed` était une IMPASSE : la bulle ne portait qu'une part texte `⚠️ …`, sans
 * aucune action. Le bloc terminal (déjà présent pour `cancelled`/`interrupted`) couvre désormais
 * `failed` : libellé propre + « ↻ Renvoyer » + « ✎ Reprendre en précisant… ».
 *
 * Cas couvert ICI : les tours DÉJÀ PERSISTÉS en part texte `⚠️ …` (aucune part d'erreur
 * structurée). Les échecs produits en direct portent, eux, une part d'erreur qui embarque sa
 * propre barre d'actions — voir `ChatView.error-part.test.tsx`.
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

const failedThread = [
  { role: 'user', content: 'ma tâche qui échoue' },
  {
    role: 'assistant',
    content: '⚠️ quota dépassé',
    parts: [{ kind: 'text', text: '⚠️ quota dépassé' }],
    status: 'failed'
  }
]

describe('ChatView — tour en échec (persisté en texte)', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  async function openFailed(
    overrides: Record<string, unknown> = {}
  ): Promise<ReturnType<typeof vi.fn>> {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', failedThread)]),
        pilotChat,
        ...overrides
      })
    )
    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    return pilotChat
  }

  it('affiche un libellé terminal et les deux actions de reprise', async () => {
    await openFailed()
    const terminal = h!.container.querySelector('.msg-terminal')
    expect(terminal).not.toBeNull()
    expect(terminal!.getAttribute('data-status')).toBe('failed')
    expect(terminal!.textContent).toContain('Réponse en échec')
    const labels = [...h!.container.querySelectorAll('.msg-terminal-action')].map((b) =>
      b.textContent?.trim()
    )
    expect(labels).toEqual(['↻ Renvoyer', '✎ Reprendre en précisant…'])
  })

  it('« ↻ Renvoyer » renvoie le prompt d’origine', async () => {
    const pilotChat = await openFailed()
    expect(pilotChat).not.toHaveBeenCalled()
    await h!.click('.msg-terminal-action')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 25))
    })
    expect(pilotChat).toHaveBeenCalledTimes(1)
    const payload = pilotChat.mock.calls[0][0] as Array<{ role: string; content: string }>
    expect(payload.at(-1)?.content).toBe('ma tâche qui échoue')
  })

  it('« ✎ Reprendre en précisant… » injecte le MOTIF réel lu dans le ⚠️ persisté', async () => {
    await openFailed()
    await h!.click('[data-testid="resume-refine"]')
    const value = h!.textarea().value
    expect(value).toContain('ma tâche qui échoue')
    expect(value).toContain('le tour précédent a échoué : quota dépassé')
  })
})
