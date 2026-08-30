// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * Defaut constate le 2026-08-30, capture a l'appui : « j'ecris dans cette conversation, ca ne la met
 * pas tout en haut de ma liste ». La barre laterale trie sur la RECENCE UTILISATEUR, mais cette date
 * n'arrivait qu'avec le rafraichissement diffuse par le processus principal — c'est-a-dire a la FIN
 * du tour. Le tri etait juste, la donnee arrivait trop tard.
 */
describe('ChatView — ecrire remonte la conversation en tete', () => {
  let harness: ChatHarness | undefined

  beforeAll(() => installRafShim())
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    localStorage.clear()
  })

  it("reordonne la liste DES l'envoi, sans attendre la fin du tour", async () => {
    const conversations = [
      { id: 'vieille', title: 'Conversation vieille', provider: 'codex', updatedAt: 100 },
      { id: 'fraiche', title: 'Conversation fraiche', provider: 'codex', updatedAt: 300 }
    ]
    harness = await mountChat(
      chatApi({
        conversations: async () => conversations,
        conversation: async (id: string) => ({
          id,
          title: conversations.find((c) => c.id === id)?.title,
          provider: 'codex',
          messages: [],
          updatedAt: 1
        })
      })
    )

    const titres = (): string[] =>
      Array.from(harness!.container.querySelectorAll('.conv-label')).map(
        (element) => element.textContent ?? ''
      )

    // Etat de depart : la plus recente ouvre la liste, la vieille est derriere.
    expect(titres()).toEqual(['Conversation fraiche', 'Conversation vieille'])

    // On ouvre la PLUS ANCIENNE (2e ligne), puis on y ecrit.
    const lignes = harness.container.querySelectorAll('.conv-pick')
    await act(async () => (lignes[1] as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    await harness.type('un message qui doit la faire remonter')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    const envoyer = [...harness.container.querySelectorAll<HTMLButtonElement>('button')].find(
      (bouton) => bouton.textContent?.trim() === 'Envoyer'
    )
    expect(envoyer).toBeTruthy()
    await act(async () => envoyer!.click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(titres()[0]).toBe('Conversation vieille')
  })
})
