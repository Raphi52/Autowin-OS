// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * « MODIFIER ET RELANCER », DE BOUT EN BOUT (conv-1038, 2026-10-21). Sous ses messages,
 * l'utilisateur n'avait que copier, brancher, inspecter et réessayer : pour corriger une demande, il
 * devait brancher au BON message puis retaper sa demande. Le bouton crée la copie qui s'arrête
 * JUSTE AVANT le message, l'ouvre, et y pose le texte du message dans la saisie, SANS envoyer.
 */
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

const source = (): Record<string, unknown> => ({
  id: 'A',
  title: 'A',
  provider: 'codex',
  updatedAt: 1,
  messages: [
    { role: 'user', content: 'première demande', ts: 1, messageId: 'm1' },
    {
      role: 'assistant',
      content: 'a1',
      ts: 1,
      messageId: 'm2',
      turnId: 't1',
      status: 'completed',
      parts: [{ kind: 'text', text: 'a1' }]
    },
    { role: 'user', content: 'seconde demande à corriger', ts: 2, messageId: 'm3' },
    {
      role: 'assistant',
      content: 'a2',
      ts: 2,
      messageId: 'm4',
      turnId: 't2',
      status: 'completed',
      parts: [{ kind: 'text', text: 'a2' }]
    }
  ]
})

const copie = {
  id: 'A-copie',
  title: 'A (fork)',
  provider: 'codex',
  updatedAt: 3,
  messages: [
    { role: 'user', content: 'première demande', ts: 1, messageId: 'f1' },
    {
      role: 'assistant',
      content: 'a1',
      ts: 1,
      messageId: 'f2',
      turnId: 't1',
      status: 'completed',
      parts: [{ kind: 'text', text: 'a1' }]
    }
  ]
}

describe('ChatView — « Modifier et relancer » sur un message de l’utilisateur', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  let api: Record<string, unknown>

  beforeEach(async () => {
    window.localStorage.clear()
    api = chatApi({
      conversations: vi.fn().mockResolvedValueOnce([source()]).mockResolvedValue([source(), copie]),
      conversation: vi.fn(async (id: string) => (id === 'A-copie' ? copie : source())),
      conversationsFork: vi.fn().mockResolvedValue(copie)
    })
    h = await mountChat(api)
    await h.click('.conv-pick')
  })

  afterEach(async () => {
    await h?.unmount()
    h = null
  })

  function boutonsModifier(): HTMLButtonElement[] {
    return [
      ...h!.container.querySelectorAll<HTMLButtonElement>(
        'button[aria-label="Modifier et relancer ce message"]'
      )
    ]
  }

  async function cliquer(bouton: HTMLButtonElement): Promise<void> {
    await act(async () => {
      bouton.click()
      for (let i = 0; i < 6; i += 1) await Promise.resolve()
    })
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }

  it('un bouton sous CHAQUE message de l’utilisateur, aucun sous les réponses', () => {
    expect(boutonsModifier()).toHaveLength(2)
  })

  it('second message : copie ancrée JUSTE AVANT lui, ouverte, son texte dans la saisie, rien d’envoyé', async () => {
    await cliquer(boutonsModifier()[1])
    expect(api.conversationsFork).toHaveBeenCalledWith('A', 'm2')
    expect(
      h!.container
        .querySelector('[data-testid="chat-view"]')
        ?.getAttribute('data-active-conversation-id')
    ).toBe('A-copie')
    expect(h!.textarea().value).toBe('seconde demande à corriger')
    expect(api.pilotChat).not.toHaveBeenCalled()
  })

  it('premier message : aucune copie, un fil neuf avec son texte dans la saisie', async () => {
    await cliquer(boutonsModifier()[0])
    expect(api.conversationsFork).not.toHaveBeenCalled()
    expect(
      h!.container
        .querySelector('[data-testid="chat-view"]')
        ?.getAttribute('data-active-conversation-id')
    ).toBe('')
    expect(h!.textarea().value).toBe('première demande')
    expect(api.pilotChat).not.toHaveBeenCalled()
  })
})
