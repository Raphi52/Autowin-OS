// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { JarvisWidget } from './JarvisWidget'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

class FakeRecognition {
  static instances: FakeRecognition[] = []
  continuous = false
  interimResults = false
  lang = ''
  demarrages = 0
  arrets = 0
  onresult: ((e: unknown) => void) | null = null
  onend: (() => void) | null = null
  onerror: ((e: unknown) => void) | null = null
  constructor() {
    FakeRecognition.instances.push(this)
  }
  start(): void {
    this.demarrages += 1
  }
  stop(): void {
    this.arrets += 1
  }
  abort(): void {
    this.arrets += 1
  }
  /** Rejoue ce que rend un moteur réel : une liste de résultats, finaux ou non. */
  dire(texte: string, final: boolean): void {
    this.onresult?.({
      resultIndex: 0,
      results: [Object.assign([{ transcript: texte }], { isFinal: final })]
    })
  }
}

const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []
const routeConversationMessage = vi.fn(async () => ({ conversationId: 'c-jarvis', routed: true }))
const conversations = vi.fn(async () => [
  {
    id: 'c-1',
    title: 'Run en cours',
    updatedAt: Date.now(),
    messageCount: 4,
    lastAssistantStatus: 'streaming'
  }
])

function rendre(props: Record<string, unknown> = {}) {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  act(() => root.render(createElement(JarvisWidget, props as never)))
  monte.push({ root, container })
  return container
}

const clic = (container: HTMLElement, testid: string): void => {
  const bouton = container.querySelector<HTMLButtonElement>(`[data-testid="${testid}"]`)
  if (!bouton) throw new Error(`bouton absent : ${testid}`)
  act(() => bouton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
}

beforeEach(() => {
  FakeRecognition.instances = []
  routeConversationMessage.mockClear()
  conversations.mockClear()
  ;(window as never as Record<string, unknown>).SpeechRecognition = FakeRecognition
  ;(window as never as Record<string, unknown>).api = {
    conversations,
    conversationsCreate: vi.fn(async () => ({ id: 'c-jarvis' })),
    routeConversationMessage
  }
})

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

describe('widget Jarvis', () => {
  it('n’écoute pas avant d’avoir été activé', () => {
    rendre()
    expect(FakeRecognition.instances).toHaveLength(0)
  })

  it('écoute en continu une fois activé', () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    expect(moteur.demarrages).toBe(1)
    expect(moteur.continuous).toBe(true)
    expect(moteur.interimResults).toBe(true)
  })

  it('relance le moteur quand il s’arrête tout seul, TANT QUE le widget est activé', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : un moteur de reconnaissance se coupe seul après un silence.
    // Sans relance, « écoute en permanence » ne dure qu'une poignée de secondes ; avec une relance
    // NON gardée, il repartirait après que l'utilisateur a coupé — micro ouvert à son insu.
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    act(() => moteur.onend?.())
    expect(moteur.demarrages).toBe(2)

    clic(c, 'jarvis-bascule')
    const apresArret = moteur.demarrages
    act(() => moteur.onend?.())
    expect(moteur.demarrages).toBe(apresArret)
  })

  it('n’envoie une parole à Jarvis que si le mot d’éveil est prononcé', async () => {
    const c = rendre()
    clic(c, 'jarvis-bascule')
    const moteur = FakeRecognition.instances.at(-1)!
    await act(async () => moteur.dire('on ira manger à midi', true))
    expect(routeConversationMessage).not.toHaveBeenCalled()
    expect(c.textContent).toContain('on ira manger à midi')

    await act(async () => moteur.dire('Jarvis, ouvre le task manager', true))
    expect(routeConversationMessage).toHaveBeenCalledWith('c-jarvis', 'ouvre le task manager', [])
  })

  it('affiche les conversations en direct', async () => {
    const c = rendre()
    await act(async () => {
      await Promise.resolve()
    })
    expect(conversations).toHaveBeenCalled()
    expect(c.textContent).toContain('Run en cours')
  })
})
