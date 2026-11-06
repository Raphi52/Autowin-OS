// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * UN CLIC SUR UN COMPTE AVANT LE PREMIER MESSAGE VAUT POUR LE FIL QUI VA NAÎTRE.
 *
 * Avant, sans conversation ouverte, le clic ne changeait que le compte de l'application : rien
 * n'était retenu, et le fil neuf pouvait changer de compte tout seul au premier quota vide. Même
 * chemin que le modèle armé : le choix se pose sur le fil AVANT son premier tour.
 */
describe('ChatView — compte armé pour le fil neuf', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('le compte cliqué se pose sur le fil neuf avant son premier tour', async () => {
    const comptes = {
      activeId: 'default',
      accounts: [
        { id: 'default', displayName: 'Compte principal', tier: 'max' },
        { id: 'compte-2', displayName: 'Compte pro', tier: 'team' }
      ]
    }
    const ordre: string[] = []
    const conversationSetClaudeAccount = vi.fn(async (_id: string, compte: string | null) => {
      ordre.push('compte')
      return compte
    })
    const pilotChat = vi.fn(async () => {
      ordre.push('tour')
      return { ok: true }
    })
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([]),
        conversationsCreate: vi.fn().mockResolvedValue(conversation('NEUF')),
        conversation: vi.fn().mockResolvedValue(conversation('NEUF')),
        claudeAccounts: vi.fn().mockResolvedValue(comptes),
        claudeAccountSwitch: vi.fn().mockResolvedValue({ ...comptes, activeId: 'compte-2' }),
        conversationSetClaudeAccount,
        pilotChat
      })
    )
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const selecteur = harness.container.querySelector<HTMLDetailsElement>(
      '[data-testid="chat-orchestrator-model"]'
    )
    expect(selecteur).not.toBeNull()
    await act(async () => {
      selecteur!.open = true
      selecteur!.dispatchEvent(new Event('toggle'))
    })
    const puce = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="conv-claude-account-compte-2"]'
    )
    expect(puce).not.toBeNull()
    await act(async () => puce?.click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    // Aucun fil encore : rien à mémoriser, mais la puce montre bien le choix armé.
    expect(conversationSetClaudeAccount).not.toHaveBeenCalled()
    expect(puce?.getAttribute('aria-pressed')).toBe('true')

    await harness.type('premier message')
    await harness.click('.composer-send')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    expect(conversationSetClaudeAccount).toHaveBeenCalledWith('NEUF', 'compte-2')
    expect(ordre).toEqual(['compte', 'tour'])
  })
})
