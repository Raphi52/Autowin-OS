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
 * LE COMPTE CLAUDE RESTE MODIFIABLE PENDANT QU'UNE CONVERSATION TRAVAILLE (demande du 2026-10-21).
 *
 * Avant : `ChatView` passait `busy: compteBusy || busy` au bloc « Compte ». Pendant un tour, les
 * puces de compte étaient grisées dans les deux pop-ups (modèle et quotas) — et la pop-up de modèle
 * ne s'ouvrait même plus. Or c'est justement pendant un tour qu'on bute sur un quota épuisé.
 * Changer de compte ne touche pas le tour déjà parti : le CLI a lu son compte à son lancement
 * (`claude-accounts.ts`, `switchTo` ne fait que mémoriser), le suivant repart sur le nouveau.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION SAUTE : un morceau de texte reçu sur la
 * conversation ouverte (elle passe « en cours »), puis un clic sur une puce de compte.
 */
describe('ChatView — compte modifiable pendant un tour', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('conversation en cours ⇒ la pop-up s’ouvre, la puce de compte est cliquable et le choix part', async () => {
    const comptes = {
      activeId: 'default',
      accounts: [
        { id: 'default', displayName: 'Compte principal', tier: 'max' },
        { id: 'compte-2', displayName: 'Compte pro', tier: 'team' }
      ]
    }
    const conversationSetClaudeAccount = vi.fn().mockResolvedValue('compte-2')
    const claudeAccountSwitch = vi.fn().mockResolvedValue({ ...comptes, activeId: 'compte-2' })
    let pilote!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A', [{ role: 'user', content: 'go' }])]),
        conversation: vi
          .fn()
          .mockResolvedValue(conversation('A', [{ role: 'user', content: 'go' }])),
        claudeAccounts: vi.fn().mockResolvedValue(comptes),
        conversationSetClaudeAccount,
        claudeAccountSwitch,
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await harness.click('.conv-pick')
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille ' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const selecteur = harness.container.querySelector<HTMLDetailsElement>(
      '[data-testid="chat-orchestrator-model"]'
    )
    expect(selecteur).not.toBeNull()
    // Le tour est bien en cours : sans ça, le test passerait sans rien prouver.
    expect(harness.container.querySelector('#chat-orchestrator-model-help')?.textContent).toMatch(
      /tour en cours/
    )
    // La pop-up s'ouvre pendant le tour : c'est le chemin vers le bloc « Compte ».
    expect(selecteur?.hasAttribute('data-disabled')).toBe(false)
    await act(async () => {
      selecteur!.open = true
      selecteur!.dispatchEvent(new Event('toggle'))
    })

    const puce = document.body.querySelector<HTMLButtonElement>(
      '[data-testid="conv-claude-account-compte-2"]'
    )
    expect(puce).not.toBeNull()
    expect(puce?.disabled).toBe(false)
    await act(async () => puce?.click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(conversationSetClaudeAccount).toHaveBeenCalledWith('A', 'compte-2')
    expect(claudeAccountSwitch).toHaveBeenCalledWith('compte-2')
  })
})
