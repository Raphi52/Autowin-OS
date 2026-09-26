// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * UNE ORIENTATION ARRIVEE TROP TARD NE DOIT PLUS DISPARAITRE.
 *
 * Rapporte le 2026-09-11 : « quand j'oriente ca oublie parfois ». Cause : une directive n'est lue
 * qu'aux points d'iteration de la boucle pilote ; celle qui arrive pendant la redaction de la
 * reponse finale n'en rencontre aucun, et le `finally` du tour la SUPPRIMAIT en la qualifiant
 * d'obsolete. Le texte restait visible dans le fil alors que le modele ne l'avait jamais vu.
 *
 * Le tour la renvoie desormais a l'ecran (`directives-orphelines`), qui la remet en file : elle
 * repart comme un tour normal, et une mention le dit.
 */
describe('ChatView — orientation non lue en fin de tour', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(): Promise<{
    app: (event: Record<string, unknown>) => void
    chat: ReturnType<typeof vi.fn>
  }> {
    let app!: (event: Record<string, unknown>) => void
    const chat = vi.fn().mockResolvedValue({ ok: true, text: 'ok' })
    harness = await mountChat(
      chatApi({
        pilotChat: chat,
        // La conversation A doit etre OUVERTE : le drain ne vise que le fil actif.
        appState: vi.fn().mockResolvedValue({ activeConversationId: 'A' }),
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { app, chat }
  }

  it('elle repart comme un vrai message au lieu d’être jetée', async () => {
    const { app, chat } = await monter()
    await act(async () =>
      app({ type: 'directives-orphelines', convId: 'A', textes: ['décale les icônes de 4 px'] })
    )
    await act(async () => {})
    const envoyes = chat.mock.calls.map((call) => JSON.stringify(call))
    expect(envoyes.some((appel) => appel.includes('décale les icônes de 4 px'))).toBe(true)
  })

  it('le fil le DIT — l’oubli silencieux est ce qu’on corrige', async () => {
    const { app } = await monter()
    await act(async () => app({ type: 'directives-orphelines', convId: 'A', textes: ['fais X'] }))
    await act(async () => {})
    expect(harness!.container.textContent ?? '').toContain('après la fin du tour')
  })

  it('une liste vide ne relance RIEN', async () => {
    const { app, chat } = await monter()
    await act(async () => app({ type: 'directives-orphelines', convId: 'A', textes: [] }))
    await act(async () => {})
    expect(chat).not.toHaveBeenCalled()
  })
})
