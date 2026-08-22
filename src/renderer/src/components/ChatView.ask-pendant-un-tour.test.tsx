// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * DEFAUT VECU le 22/08 (conv-1363) : « je clique dans le bloc ask, il se passe rien ».
 *
 * `ask` ne SUSPEND pas le tour — le pilote enchaine son iteration suivante sans attendre. Le bloc
 * reste donc affiche pendant que la conversation est occupee, et son clic passait par `send()`, qui
 * sort EN SILENCE quand la conversation est `busy` (aucune file, aucun recu, aucun message). Le
 * composer, lui, traite deja ce cas : un message tape pendant un tour ORIENTE (`submitBtw`). Deux
 * chemins pour un seul geste, un seul des deux branche.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : le clic sur une option alors
 * qu'un tour est en cours. Si le clic retombe sur `send()`, `injectDirective` n'est jamais appelee.
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

describe('ChatView — le bloc ask reste cliquable pendant un tour', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(injecte: ReturnType<typeof vi.fn>): Promise<{
    pilote: (event: Record<string, unknown>) => void
  }> {
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
    return { pilote }
  }

  const options = (): HTMLButtonElement[] =>
    Array.from(harness!.container.querySelectorAll<HTMLButtonElement>('button.askd-choix'))

  it('un tour en cours ⇒ le choix ORIENTE le tour, il ne disparaît pas dans le vide', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: true })
    const { pilote } = await monter(injecte)
    expect(options()).toHaveLength(2)
    // Un tour tourne (delta reçu) ⇒ `busy` est vrai pour la conversation A.
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))

    await act(async () => options()[0].click())
    await act(async () => {})

    expect(injecte).toHaveBeenCalledWith('A', 'Oui, corrige')
  })

  it('aucun tour en cours ⇒ le choix part comme un message normal', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: true })
    await monter(injecte)
    expect(options()).toHaveLength(2)

    await act(async () => options()[0].click())
    await act(async () => {})

    expect(injecte).not.toHaveBeenCalled()
    expect(window.api.pilotChat).toHaveBeenCalled()
  })
})
