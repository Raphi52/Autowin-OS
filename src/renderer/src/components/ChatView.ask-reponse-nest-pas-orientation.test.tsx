// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LE DÉFAUT, vécu le 2026-08-26 (capture de l'utilisateur).
 *
 * Répondre à une question `ask` pendant qu'un run tournait empruntait le chemin de l'ORIENTATION
 * en vol. Le transport était bon (injection dans le tour), mais le fil affichait « ✓ Orienté » :
 * l'utilisateur répondait à une question et l'écran lui disait qu'il avait orienté l'agent — un
 * geste qu'il n'avait pas fait. Le libellé mentait sur la nature du message.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER LA CORRECTION SI ELLE EST FAUSSE : le clic sur une option ALORS
 * QU'UN TOUR EST EN COURS. Hors tour, aucun reçu n'est posé et le test ne discriminerait rien.
 */
const askPart = {
  kind: 'action' as const,
  name: 'ask',
  ok: true,
  data: {
    question: 'J’ajoute la pastille ambre ?',
    options: [{ libelle: 'Oui — 8e état needs-human' }, { libelle: 'Non, juste l’analyse' }]
  }
}

const avecAsk = conversation('A', [
  { role: 'user', content: 'refais le bloc ask' },
  { role: 'assistant', content: '', parts: [askPart], status: 'done' }
])

describe('ChatView — une réponse à une question n’est pas une orientation', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('affiche « Répondu », jamais « Orienté », quand un tour est en cours', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: true })
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

    const options = () =>
      Array.from(harness!.container.querySelectorAll<HTMLButtonElement>('button.askd-choix'))
    await act(async () => options()[0].click())
    await act(async () => {})

    expect(injecte).toHaveBeenCalledWith('A', 'Oui — 8e état needs-human')
    const recu = harness.container.querySelector('.directive-receipt-status')?.textContent ?? ''
    expect(recu).toContain('Répondu')
    expect(recu).not.toContain('prochaine réponse')
  })
})
