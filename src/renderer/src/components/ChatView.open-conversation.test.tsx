// @vitest-environment happy-dom
/**
 * OUVERTURE d'une conversation demandée par un AUTRE écran (bulle d'un ticket, accueil).
 *
 * Deux défauts vécus le 2026-09-17, tous deux invisibles : l'ouverture était ignorée et le chat
 * restait sur la conversation affichée, ce qui se lisait comme « ça part toujours sur la dernière ».
 *   1. l'identifiant arrive parfois NU (chaîne) et non dans `{ conversationId }` ;
 *   2. la conversation vient d'être créée : elle n'est pas encore dans la liste en mémoire.
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
import { deposerOuvertureConversation } from './pending-conversation-open'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

async function demanderOuverture(detail: unknown): Promise<void> {
  await act(async () => {
    window.dispatchEvent(new CustomEvent('autowin:open-conversation', { detail }))
    await new Promise((r) => setTimeout(r, 10))
  })
}

describe('ChatView — ouverture demandée de l’extérieur', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    vi.restoreAllMocks()
  })

  it('identifiant NU en chaîne : la conversation demandée est chargée', async () => {
    const conversations = vi.fn().mockResolvedValue([conversation('A', []), conversation('B', [])])
    h = await mountChat(chatApi({ conversations }))
    await demanderOuverture('B')
    expect(h.container.textContent).toContain('B')
  })

  // Chat DÉMONTÉ au moment du clic (on était sur l'écran des fiches) : l'événement n'a aucun
  // auditeur. La demande déposée doit être honorée au montage, et PASSER AVANT l'alignement sur la
  // conversation active du main — sinon le chat s'ouvre sur la dernière créée.
  it('demande déposée pendant que le chat est absent : elle gagne sur la conversation active', async () => {
    // Chaque conversation porte un message RECONNAISSABLE : le titre seul ne prouverait rien, il
    // apparaît dans la liste latérale même sans être ouvert.
    deposerOuvertureConversation('DEMANDEE')
    const appState = vi.fn().mockResolvedValue({ activeConversationId: 'ACTIVE' })
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([
          conversation('DEMANDEE', [{ role: 'user', content: 'fil-de-la-demandee' }]),
          conversation('ACTIVE', [{ role: 'user', content: 'fil-de-lactive' }])
        ]),
        appState
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(h.container.textContent).toContain('fil-de-la-demandee')
    expect(h.container.textContent).not.toContain('fil-de-lactive')
  })

  it('conversation absente de la liste en mémoire : la liste est relue avant d’abandonner', async () => {
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([conversation('A', [])])
      .mockResolvedValue([conversation('A', []), conversation('NEUVE', [])])
    h = await mountChat(chatApi({ conversations }))
    const avant = conversations.mock.calls.length
    await demanderOuverture('NEUVE')
    expect(conversations.mock.calls.length).toBeGreaterThan(avant)
    expect(h.container.textContent).toContain('NEUVE')
  })
})
