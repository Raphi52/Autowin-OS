// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

const { chatApi, conversation, installRafShim, mountChat } = await import('./ChatView.harness')
type Harness = Awaited<ReturnType<typeof mountChat>>

/**
 * LE BANDEAU DE PAUSE DU MODE AUTO APPARTIENT À SON FIL (conv-891, capture du 2026-09-30 12:22:46).
 *
 * conv-885 a levé « Mode auto en pause : la suite proposée attend des informations que toi seul peux
 * donner » le 2026-09-29 à 10:47 (suite « J'ai validé le code Quick Login : … »). Le bandeau vivait
 * dans un emplacement UNIQUE de l'écran du chat : 26 h plus tard il s'affichait encore au-dessus de
 * conv-890, qui tournait et n'attendait rien, sans dire de quel fil il venait.
 */
const cloture = (suite: string): string =>
  [
    '✅ Fait',
    '1. Le menu est habillé.',
    '📍 Maintenant : la connexion Studio est requise.',
    '⏳ Reste à faire : capturer les écrans.',
    `👉 Recommandé : ${suite}`
  ].join('\n')

const filEnPause: unknown[] = [
  { role: 'user', content: 'habille le menu' },
  {
    role: 'assistant',
    content: cloture("J'ai validé le code Quick Login : capture les écrans Bataille et Boutique")
  }
]

describe('ChatView — le bandeau de pause du mode auto reste dans son fil et le nomme', () => {
  beforeAll(installRafShim)
  let h: Harness | null = null
  afterEach(async () => {
    await h?.unmount()
    h = null
    window.localStorage.clear()
    vi.restoreAllMocks()
  })

  const bandeau = (): string =>
    [...document.querySelectorAll('.chat-workflow-notice')].map((n) => n.textContent).join(' | ')

  async function monterEtMettreEnPause(): Promise<NodeListOf<Element>> {
    h = await mountChat(
      chatApi({
        pilotChat: vi.fn().mockResolvedValue({ ok: true }),
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A', filEnPause), conversation('B', [])]),
        conversation: vi.fn(async (id: string) => conversation(id, id === 'A' ? filEnPause : []))
      })
    )
    const items = document.querySelectorAll('.conv-item .conv-pick')
    await act(async () => (items[0] as HTMLElement).click())
    await h.click('[data-testid="composer-auto-toggle"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    return items
  }

  it('la pause est affichée dans son fil, avec le nom du fil', async () => {
    await monterEtMettreEnPause()
    expect(bandeau()).toContain('Mode auto en pause')
    expect(bandeau()).toContain('« Conversation A »')
  })

  it('un autre fil ne montre pas la pause d’un fil voisin, et la retrouve au retour', async () => {
    const items = await monterEtMettreEnPause()
    expect(bandeau()).toContain('Mode auto en pause')

    await act(async () => (items[1] as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(bandeau()).not.toContain('Mode auto en pause')

    await act(async () => (items[0] as HTMLElement).click())
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    expect(bandeau()).toContain('Mode auto en pause')
  })

  it('la croix efface la pause de ce fil', async () => {
    await monterEtMettreEnPause()
    await h!.click('[data-testid="chat-auto-arret"] button')
    expect(bandeau()).not.toContain('Mode auto en pause')
  })
})
