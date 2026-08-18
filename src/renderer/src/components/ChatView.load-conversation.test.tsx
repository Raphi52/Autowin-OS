// @vitest-environment happy-dom
/**
 * `loadConv` n'avait NI try/catch NI état : une IPC `conversation()` qui rejette laissait une
 * promesse non gérée et un fil vide, sans le moindre signe. Trois garanties ici :
 * chargement visible, échec visible + « Réessayer », réponse PÉRIMÉE ignorée.
 */
import { act, createElement } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => createElement('span', null, text),
  extractRecommendation: (): string | null => null
}))

// Conversations SANS `messages` : c'est le seul cas où `loadConv` va chercher le détail par IPC.
const stubs = [
  { id: 'A', title: 'Conversation A', category: 'codex', provider: 'codex', updatedAt: 1 },
  { id: 'B', title: 'Conversation B', category: 'codex', provider: 'codex', updatedAt: 2 }
]

function deferred<T>(): {
  promise: Promise<T>
  resolve: (v: T) => void
  reject: (e: unknown) => void
} {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

describe('ChatView — chargement d’une conversation', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null
  const rejections: unknown[] = []
  const onUnhandled = (event: PromiseRejectionEvent): void => {
    rejections.push(event.reason)
  }
  beforeAll(() => window.addEventListener('unhandledrejection', onUnhandled))
  afterEach(async () => {
    // La reprise au boot lit la derniere conversation ouverte en localStorage (feature du
    // 2026-08-18). Sans ce nettoyage, un test laisse un identifiant qui fait charger une
    // conversation au montage du SUIVANT — ce qui consommait un `mockImplementationOnce` et
    // decalait toute la sequence de la course peremption/fraicheur testee ici.
    localStorage.clear()
    await h?.unmount()
    h = null
    rejections.length = 0
    vi.restoreAllMocks()
  })

  it('échec IPC ⇒ bandeau d’erreur + « Réessayer », sans rejet non géré', async () => {
    const conversation = vi
      .fn()
      .mockResolvedValue({ ...stubs[0], messages: [{ role: 'user', content: 'salut' }] })
    h = await mountChat(chatApi({ conversations: vi.fn().mockResolvedValue(stubs), conversation }))

    // Le boot ouvre desormais LA PLUS RECENTE (demande du 2026-08-18) : il consomme un appel. Ces
    // tests portent sur le chargement declenche par un CLIC — on isole donc leur sequence du boot,
    // sinon le premier `Once` serait mange par l'ouverture automatique.
    conversation.mockClear()
    conversation.mockRejectedValueOnce(new Error('store injoignable'))

    await h.click('.conv-pick')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })

    const banner = h.container.querySelector('.conv-load-error')
    expect(banner).not.toBeNull()
    expect(banner!.getAttribute('role')).toBe('alert')
    expect(banner!.textContent).toContain('store injoignable')
    expect(rejections).toEqual([])

    // « Réessayer » relance la MÊME conversation et fait disparaître le bandeau.
    await h.click('.conv-load-retry')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(conversation).toHaveBeenCalledTimes(2)
    expect(h.container.querySelector('.conv-load-error')).toBeNull()
    expect(h.container.textContent).toContain('salut')
  })

  it('affiche un squelette pendant le chargement puis ignore la réponse PÉRIMÉE', async () => {
    const first = deferred<unknown>()
    const second = deferred<unknown>()
    const conversation = vi.fn().mockResolvedValue({ ...stubs[0], messages: [] })
    h = await mountChat(chatApi({ conversations: vi.fn().mockResolvedValue(stubs), conversation }))

    // Meme isolation : les deux reponses differees appartiennent aux deux CLICS ci-dessous.
    conversation.mockClear()
    conversation
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise)

    const picks = (): NodeListOf<Element> => h!.container.querySelectorAll('.conv-pick')
    await act(async () => (picks()[0] as HTMLElement).click())
    expect(h.container.querySelector('.conv-load-skeleton')).not.toBeNull()

    await act(async () => (picks()[1] as HTMLElement).click())
    await act(async () => {
      // La PREMIÈRE réponse arrive APRÈS : elle est périmée, elle ne doit rien écraser.
      first.resolve({ ...stubs[0], messages: [{ role: 'user', content: 'PÉRIMÉ' }] })
      second.resolve({ ...stubs[1], messages: [{ role: 'user', content: 'À JOUR' }] })
      await new Promise((r) => setTimeout(r, 10))
    })

    expect(h.container.textContent).toContain('À JOUR')
    expect(h.container.textContent).not.toContain('PÉRIMÉ')
    expect(h.container.querySelector('.conv-load-skeleton')).toBeNull()
    expect(rejections).toEqual([])
  })
})
