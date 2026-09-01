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
 * DÉFAUT VÉCU (conv-38, 2026-09-01) : « j'ai répondu à un ask, ça a écrit le message, puis ça a
 * rechargé et le message a disparu, j'ai dû recliquer ».
 *
 * Répondre pendant un tour passait par l'injection, qui ne posait qu'un REÇU en mémoire de l'écran.
 * Le main écrit désormais un vrai message et rend son `messageId` : l'écran doit alors RETIRER son
 * reçu — sinon l'utilisateur voit deux fois le même texte (le reçu + le vrai message relu).
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : le clic sur une option ALORS
 * QU'UN TOUR EST EN COURS, avec un main qui confirme l'écriture (`messageId`). Hors tour, aucun reçu
 * n'est posé et le test ne discriminerait rien.
 */
const askPart = {
  kind: 'action' as const,
  name: 'ask',
  ok: true,
  data: {
    question: 'Je lance la correction ?',
    options: [{ libelle: 'Oui, corrige' }, { libelle: 'Non, laisse en l’état' }]
  }
}

const avecAsk = conversation('A', [
  { role: 'user', content: 'corrige le gabarit' },
  { role: 'assistant', content: '', parts: [askPart], status: 'done' }
])

describe('ChatView — répondre pendant un tour laisse un VRAI message, pas un reçu volatil', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function cliquerPendantUnTour(injecte: ReturnType<typeof vi.fn>): Promise<void> {
    let pilote!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        injectDirective: injecte,
        conversations: vi.fn().mockResolvedValue([avecAsk]),
        conversation: vi.fn().mockResolvedValue(avecAsk),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await harness.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))
    const options = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>('button.askd-choix')
    )
    expect(options).toHaveLength(2)
    await act(async () => options[0].click())
    await act(async () => {})
  }

  it('le message est écrit côté main ⇒ l’écran retire son reçu (pas de doublon)', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: true, messageId: 'A-3' })
    await cliquerPendantUnTour(injecte)

    expect(injecte).toHaveBeenCalledWith('A', 'Oui, corrige')
    // Le vrai message porte le texte : le reçu ferait doublon, il doit disparaître.
    expect(harness!.container.querySelector('.directive-receipt')).toBeNull()
  })

  it('aucune écriture confirmée ⇒ le reçu RESTE, rien n’est perdu', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: true })
    await cliquerPendantUnTour(injecte)

    expect(harness!.container.querySelector('.directive-receipt')).not.toBeNull()
  })
})
