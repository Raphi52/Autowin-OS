// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * UN MESSAGE MIS DE CÔTÉ N'EST PAS UN ÉCHEC (conv-891, capture du 2026-09-30 12:22:46).
 *
 * Tapé pendant un tour de conv-890, « et pour tester scout des améliorations… » a été lu comme la
 * commande scout ; une commande ne s'ajoute jamais à un tour en cours (`src/main/index.ts`, refus
 * volontaire), donc le texte a attendu la fin du tour. Rien n'avait échoué, et le badge disait
 * « ⚠ Échec — remis en file », en rouge. Puis le message est parti à 12:26:29 et le badge restait
 * là, en double du vrai message.
 */
describe('ChatView — le reçu d’un message mis de côté dit qu’il attend, et pourquoi', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(injecte: ReturnType<typeof vi.fn>): Promise<{
    pilote: (event: Record<string, unknown>) => void
    pilotChat: ReturnType<typeof vi.fn>
  }> {
    let pilote!: (event: Record<string, unknown>) => void
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        injectDirective: injecte,
        pilotChat,
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { pilote, pilotChat }
  }

  async function soumettrePendantUnTour(
    pilote: (event: Record<string, unknown>) => void,
    texte: string
  ): Promise<void> {
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))
    await harness!.type(texte)
    await act(async () => {
      harness!
        .textarea()
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => {})
  }

  const recu = (): string =>
    harness?.container.querySelector('.directive-receipt-status')?.textContent ?? ''

  it('lu comme une commande ⇒ attend la fin du tour, et nomme la commande', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: false, motif: 'commande', commande: 'scout' })
    const { pilote } = await monter(injecte)
    await soumettrePendantUnTour(pilote, 'et pour tester scout des améliorations du workflow')

    expect(recu()).toContain('Attend la fin du tour')
    expect(recu()).toContain('« scout »')
    expect(recu()).not.toContain('Échec')
    expect(harness!.container.querySelector('.directive-receipt.is-failed')).toBeNull()
  })

  it('refus sans motif (app principale plus ancienne) ⇒ attente, jamais « Échec »', async () => {
    const { pilote } = await monter(vi.fn().mockResolvedValue({ ok: false }))
    await soumettrePendantUnTour(pilote, 'décale les icônes de 4 px')

    expect(recu()).toContain('Attend la fin du tour')
    expect(recu()).not.toContain('Échec')
  })

  it('le tour se terminait ⇒ le motif le dit', async () => {
    const { pilote } = await monter(vi.fn().mockResolvedValue({ ok: false, motif: 'hors-tour' }))
    await soumettrePendantUnTour(pilote, 'décale les icônes de 4 px')

    expect(recu()).toContain('Attend la fin du tour')
    expect(recu()).toContain('se terminait')
  })

  it('une vraie erreur d’envoi reste une erreur, mais dit que le message attend', async () => {
    const { pilote } = await monter(vi.fn().mockRejectedValue(new Error('IPC coupée')))
    await soumettrePendantUnTour(pilote, 'décale les icônes de 4 px')

    expect(recu()).toContain('Erreur')
    expect(recu()).toContain('fin du tour')
  })

  it('une fois parti, le message mis de côté n’a plus de reçu (sinon doublon)', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: false, motif: 'commande', commande: 'scout' })
    const { pilote, pilotChat } = await monter(injecte)
    await soumettrePendantUnTour(pilote, 'et pour tester scout des améliorations du workflow')
    expect(harness!.container.querySelector('.directive-receipt')).not.toBeNull()

    await act(async () => pilote({ conversationId: 'A', kind: 'done' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })

    const envoyes = pilotChat.mock.calls.map((c) => JSON.stringify(c)).join('\n')
    expect(envoyes).toContain('et pour tester scout des améliorations du workflow')
    expect(harness!.container.querySelector('.directive-receipt')).toBeNull()
  })
})
