// @vitest-environment happy-dom
/**
 * REPRENDRE LES CONVERSATIONS COUPÉES PAR LE QUOTA.
 *
 * Demande du 2026-09-05 : « travaille pour reprendre les convers à pastille rouge qui viennent de
 * perdre leur quota ». Deux comportements se verrouillent ici, parce qu'ils sont exactement ce qui
 * distingue ce bouton d'un bouton « relancer tout » inutilisable :
 *  1. il ne s'affiche PAS quand aucune conversation n'est coupée par le quota ;
 *  2. il ne relance QUE celles-là — une pastille rouge tombée sur une vraie erreur ne bouge pas.
 */
import { describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat } from './ChatView.harness'

installRafShim()

const coupee = (id: string, erreur?: string): Record<string, unknown> => ({
  ...conversation(id),
  lastMessageRole: 'assistant',
  lastAssistantStatus: 'failed',
  ...(erreur ? { lastAssistantError: erreur } : {})
})

const bouton = (c: HTMLElement): HTMLButtonElement | null =>
  c.querySelector('[data-testid="conv-reprise-quota-bouton"]')

describe('bouton « Reprendre les conversations coupées par le quota »', () => {
  it("n'existe pas quand aucune conversation n'est coupée par le quota", async () => {
    const vue = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A'), coupee('B', 'TypeError: boom')])
      })
    )
    expect(bouton(vue.container)).toBeNull()
    await vue.unmount()
  })

  it('compte et relance UNIQUEMENT les fils dont le tour est mort sur le quota', async () => {
    const resumePilotChat = vi.fn().mockResolvedValue({ ok: true, cancelled: false, turnId: 't' })
    const vue = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([
            conversation('A'),
            coupee('B', 'Claude usage limit reached'),
            coupee('C', 'TypeError: boom'),
            coupee('D', 'insufficient_quota')
          ]),
        resumePilotChat
      })
    )
    expect(bouton(vue.container)?.textContent).toContain('(2)')

    await vue.click('[data-testid="conv-reprise-quota-bouton"]')
    // La reprise est SÉQUENTIELLE (un fil à la fois, pour ne pas retomber sur le même mur) : le
    // second départ n'a lieu qu'après le retour du premier.
    await vi.waitFor(() => expect(resumePilotChat).toHaveBeenCalledTimes(2))
    expect(resumePilotChat.mock.calls.map(([id]) => id)).toEqual(['B', 'D'])
    await vue.unmount()
  })
})
