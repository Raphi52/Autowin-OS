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
 * LE DÉFAUT, vécu le 2026-09-01 (conv-50, capture de l'utilisateur).
 *
 * L'utilisateur écrit un message pendant qu'une question `ask` est posée — un message qui parle
 * d'AUTRE CHOSE. Le bloc passait alors en « Répondu — écrivez la suite dans le composer » et son
 * verrou avalait le clic suivant EN SILENCE : « j'ai répondu a la question et ca a rien fait ».
 *
 * ENTRÉE QUI FAIT ÉCHOUER LA CORRECTION SI ELLE EST FAUSSE : un message utilisateur hors sujet
 * APRÈS le tour porteur de la question, puis un clic sur une option.
 */
const askPart = {
  kind: 'action' as const,
  name: 'ask',
  ok: true,
  data: {
    question: 'Une image collée pendant un tour : elle fait quoi ?',
    options: [
      { libelle: 'Elle part avec mon orientation' },
      { libelle: 'Elle attend la fin du tour' }
    ]
  }
}

const filAvecHorsSujet = conversation('A', [
  { role: 'user', content: 'coller une image pendant un tour' },
  { role: 'assistant', content: '', parts: [askPart], status: 'done' },
  { role: 'user', content: 'ca la met juste dans la barre de prompt comme si je la collais pas' }
])

describe('ChatView — un message hors sujet ne ferme pas la question', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('le bloc reste ouvert et le clic ENVOIE vraiment la réponse', async () => {
    const envoie = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        pilotChat: envoie,
        conversations: vi.fn().mockResolvedValue([filAvecHorsSujet]),
        conversation: vi.fn().mockResolvedValue(filAvecHorsSujet)
      })
    )
    await harness.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    const bloc = harness.container.querySelector('[data-testid="ask-decision"]')
    expect(bloc).toBeTruthy()
    expect(bloc?.getAttribute('data-repondu')).toBe(null)
    expect(harness.container.querySelector('[data-testid="ask-decision-close"]')).toBe(null)

    const options = Array.from(
      harness.container.querySelectorAll<HTMLButtonElement>('button.askd-choix')
    )
    expect(options[0].disabled).toBe(false)
    await act(async () => options[0].click())
    await act(async () => {})

    const envois = envoie.mock.calls.map((appel) => JSON.stringify(appel))
    expect(envois.some((appel) => appel.includes('Elle part avec mon orientation'))).toBe(true)
  })
})
