// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ChatView } from './ChatView'

const markdownRenderCount = vi.hoisted(() => ({ value: 0 }))
vi.mock('./Markdown', () => ({
  Markdown: ({ text }: { text: string }) => {
    markdownRenderCount.value += 1
    return createElement('span', null, text)
  }
}))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
  reject: (error: unknown) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}

const conversation = (id: string, messages: unknown[] = []) => ({
  id,
  title: `Conversation ${id}`,
  category: 'codex',
  provider: 'codex',
  messages,
  updatedAt: 1
})

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversations: vi.fn().mockResolvedValue([]),
    conversationRuns: vi.fn().mockResolvedValue([]),
    listRuns: vi.fn().mockResolvedValue([]),
    authorityPending: vi.fn().mockResolvedValue([]),
    topology: vi.fn().mockResolvedValue({
      orchestrator: { provider: 'codex', modelId: 'gpt', reasoningEffort: 'auto' }
    }),
    models: vi.fn().mockResolvedValue([{ id: 'gpt', provider: 'codex', model: 'gpt' }]),
    roles: vi.fn().mockResolvedValue({ orchestrator: { provider: 'codex', model: 'gpt' } }),
    onAppEvent: vi.fn(() => vi.fn()),
    onPilotEvent: vi.fn(() => vi.fn()),
    setActiveConversation: vi.fn(),
    conversationsCreate: vi.fn(),
    pilotChat: vi.fn().mockResolvedValue({ ok: true }),
    markResponseDisplayed: vi.fn().mockResolvedValue(undefined),
    cancelPilotChat: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
}

describe('ChatView behavior under concurrent UI actions', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    Object.defineProperty(window, 'requestAnimationFrame', {
      configurable: true,
      value: (callback: FrameRequestCallback) => window.setTimeout(() => callback(0), 0)
    })
  })

  let container: HTMLDivElement | null = null
  let root: Root | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    container?.remove()
    root = null
    container = null
    vi.restoreAllMocks()
  })

  async function mount(mockApi: Record<string, unknown>): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', { configurable: true, value: mockApi })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView))
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  async function type(value: string): Promise<void> {
    const textarea = container?.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, value)
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
  }

  async function click(selector: string): Promise<void> {
    const element = container?.querySelector(selector) as HTMLElement
    await act(async () => element.click())
  }

  it('blocks a synchronous double Enter with one pilot request', async () => {
    const pilot = deferred<{ ok: boolean }>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('B')]),
      pilotChat: vi.fn(() => pilot.promise)
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('une seule fois')
    const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
    await act(async () => {
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
      textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    expect(mockApi.pilotChat).toHaveBeenCalledTimes(1)
    await act(async () => pilot.resolve({ ok: true }))
  })

  it('ne perd pas un événement pilote encore en vol quand le tour se termine', async () => {
    const pilot = deferred<{ ok: boolean }>()
    let pilotHandler: ((event: unknown) => void) | undefined
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A')]),
      pilotChat: vi.fn(() => pilot.promise),
      onPilotEvent: vi.fn((cb: (event: unknown) => void) => {
        pilotHandler = cb
        return vi.fn()
      })
    })
    await mount(mockApi)
    await click('.conv-pick')
    await type('question rapide')
    await click('.composer-send')
    await act(async () => {
      // Événement IPC EN VOL (macrotask) programmé AVANT la résolution de la promesse :
      // il doit être réduit, pas jeté par la garde busy qui se coupe à la fin du tour.
      setTimeout(() => {
        pilotHandler?.({
          conversationId: 'A',
          turnId: 'turn-tardif',
          kind: 'delta',
          streamId: '0:0',
          text: 'Réponse tardive complète'
        })
      }, 0)
      pilot.resolve({ ok: true })
      await new Promise((resolve) => setTimeout(resolve, 60))
    })
    expect(container!.textContent).toContain('Réponse tardive complète')
    expect(container!.textContent).not.toContain('aucune réponse')
  })

  it('does not steal conversation B when creation from New resolves late', async () => {
    const creation = deferred<ReturnType<typeof conversation>>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('B')]),
      conversationsCreate: vi.fn(() => creation.promise)
    })
    await mount(mockApi)
    await type('draft A')
    await click('.composer-send')
    await click('.conv-pick')
    await type('draft B')
    await act(async () => creation.resolve(conversation('A')))
    expect(
      container!.querySelector('.chat-layout')?.getAttribute('data-active-conversation-id')
    ).toBe('B')
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft B')
  })

  it('releases the New lock after assigning A while retaining A busy', async () => {
    const pilotA = deferred<{ ok: boolean }>()
    const create = vi
      .fn()
      .mockResolvedValueOnce(conversation('A'))
      .mockResolvedValueOnce(conversation('C'))
    const mockApi = api({ conversationsCreate: create, pilotChat: vi.fn(() => pilotA.promise) })
    await mount(mockApi)
    await type('premier')
    await click('.composer-send')
    await click('.conv-head .btn')
    await type('deuxième')
    await click('.composer-send')
    expect(create).toHaveBeenCalledTimes(2)
    await act(async () => pilotA.resolve({ ok: true }))
  })

  it('preserves a failed bootstrap draft and retries it', async () => {
    const models = vi
      .fn()
      .mockResolvedValue([
        { id: 'omniroute/auto/coding', provider: 'omniroute', model: 'auto/coding' }
      ])
    const create = vi.fn().mockResolvedValue(conversation('A'))
    const mockApi = api({ models, conversationsCreate: create })
    await mount(mockApi)
    models.mockRejectedValueOnce(new Error('bootstrap indisponible'))
    await type('à conserver')
    await click('.composer-send')
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('à conserver')
    expect(container!.textContent).toContain('bootstrap indisponible')
    await click('.composer-send')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('keeps delayed attachments in their originating conversation draft', async () => {
    const encoded = deferred<string>()
    const mockApi = api({
      conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')])
    })
    await mount(mockApi)
    const picks = container!.querySelectorAll('.conv-pick')
    await act(async () => (picks[0] as HTMLElement).click())
    await type('draft A')
    const file = new File(['x'], 'preuve.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', { configurable: true, value: () => encoded.promise })
    const input = container!.querySelector('input[type="file"]') as HTMLInputElement
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })))
    await act(async () => (picks[1] as HTMLElement).click())
    await type('draft B')
    await act(async () => encoded.resolve('contenu'))
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft B')
    expect(container!.querySelector('.attachment-list.pending')).toBeNull()
    await act(async () => (picks[0] as HTMLElement).click())
    expect((container!.querySelector('textarea') as HTMLTextAreaElement).value).toBe('draft A')
    expect(container!.textContent).toContain('preuve.txt')
  })

  it('does not rerender historical Markdown rows when only the composer changes', async () => {
    const history = [
      {
        role: 'assistant',
        content: 'réponse historique',
        ts: 1,
        status: 'completed',
        parts: [{ kind: 'text', text: 'réponse historique' }]
      }
    ]
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A', history)]) }))
    await click('.conv-pick')
    expect(markdownRenderCount.value).toBeGreaterThan(0)
    markdownRenderCount.value = 0
    await type('nouveau draft')
    expect(markdownRenderCount.value).toBe(0)
  })

  it('offers inspection only for persisted assistant turns and reports the exact target', async () => {
    const onInspectTurn = vi.fn()
    const history = [
      {
        role: 'assistant',
        content: 'réponse traçable',
        ts: 1,
        turnId: 'turn-42',
        status: 'completed',
        parts: [{ kind: 'text', text: 'réponse traçable' }]
      },
      {
        role: 'assistant',
        content: 'réponse historique sans trace',
        ts: 2,
        status: 'completed',
        parts: [{ kind: 'text', text: 'réponse historique sans trace' }]
      }
    ]
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api({ conversations: vi.fn().mockResolvedValue([conversation('A', history)]) })
    })
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement(ChatView, { onInspectTurn }))
      await Promise.resolve()
      await Promise.resolve()
    })
    await click('.conv-pick')

    const inspectButtons = [...container.querySelectorAll('button')].filter(
      (button) => button.getAttribute('aria-label') === 'Inspecter ce tour'
    )
    expect(inspectButtons).toHaveLength(1)
    await act(async () => (inspectButtons[0] as HTMLButtonElement).click())
    expect(onInspectTurn).toHaveBeenCalledWith({ conversationId: 'A', turnId: 'turn-42' })
  })

  it('exposes the message stream as an aria-live log region for screen readers', async () => {
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) }))
    const scroll = container!.querySelector('.chat-scroll')
    expect(scroll?.getAttribute('role')).toBe('log')
    expect(scroll?.getAttribute('aria-live')).toBe('polite')
  })

  it('adds a pasted file to the composer draft via onPaste', async () => {
    const encoded = deferred<string>()
    await mount(api({ conversations: vi.fn().mockResolvedValue([conversation('A')]) }))
    await click('.conv-pick')
    const file = new File(['x'], 'colle.txt', { type: 'text/plain' })
    Object.defineProperty(file, 'text', { configurable: true, value: () => encoded.promise })
    const textarea = container!.querySelector('textarea') as HTMLTextAreaElement
    const paste = new Event('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(paste, 'clipboardData', { configurable: true, value: { files: [file] } })
    await act(async () => {
      textarea.dispatchEvent(paste)
    })
    await act(async () => encoded.resolve('contenu'))
    expect(container!.textContent).toContain('colle.txt')
  })

  const branched = (activeBranchId: string): Record<string, unknown> => ({
    id: 'A',
    title: 'A',
    category: 'codex',
    provider: 'codex',
    updatedAt: 1,
    rootBranchId: 'branch-A-root',
    activeBranchId,
    branches: [
      { id: 'branch-A-root' },
      { id: 'branch-A-2', parentBranchId: 'branch-A-root', forkedFromMessageId: 'm2' }
    ],
    messages: [
      { role: 'user', content: 'u1', ts: 1, messageId: 'm1', branchId: 'branch-A-root' },
      {
        role: 'assistant',
        content: 'a1',
        ts: 1,
        messageId: 'm2',
        branchId: 'branch-A-root',
        parentMessageId: 'm1',
        turnId: 't1',
        status: 'completed',
        parts: [{ kind: 'text', text: 'a1' }]
      },
      {
        role: 'user',
        content: 'u2',
        ts: 2,
        messageId: 'm3',
        branchId: 'branch-A-root',
        parentMessageId: 'm2'
      },
      {
        role: 'user',
        content: 'alt',
        ts: 3,
        messageId: 'm5',
        branchId: 'branch-A-2',
        parentMessageId: 'm2'
      }
    ]
  })

  it('forke depuis un tour assistant persistant en appelant conversationsFork', async () => {
    const fork = vi.fn().mockResolvedValue(undefined)
    const conv = branched('branch-A-root')
    await mount(api({ conversations: vi.fn().mockResolvedValue([conv]), conversationsFork: fork }))
    await click('.conv-pick')
    const assistantRow = container!.querySelector('.msg.assistant') as HTMLElement
    const forkBtn = [...assistantRow.querySelectorAll('button')].find((b) =>
      /branche/i.test(b.getAttribute('aria-label') ?? '')
    )
    expect(forkBtn).toBeTruthy()
    await act(async () => (forkBtn as HTMLButtonElement).click())
    expect(fork).toHaveBeenCalledWith('A', 'm2')
  })

  it('affiche les branches et bascule via conversationsSwitchBranch', async () => {
    const sw = vi.fn().mockResolvedValue(undefined)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([branched('branch-A-root')]),
        conversationsSwitchBranch: sw
      })
    )
    await click('.conv-pick')
    const chips = container!.querySelectorAll('.branch-chip')
    expect(chips.length).toBe(2)
    await act(async () => (chips[1] as HTMLElement).click())
    expect(sw).toHaveBeenCalledWith('A', 'branch-A-2')
  })

  it('ne rend que la chaîne de la branche active', async () => {
    await mount(api({ conversations: vi.fn().mockResolvedValue([branched('branch-A-2')]) }))
    await click('.conv-pick')
    const body = container!.querySelector('.chat-scroll')!.textContent ?? ''
    expect(body).toContain('u1')
    expect(body).toContain('alt')
    expect(body).not.toContain('u2') // message postérieur au fork sur la branche parente
  })

  it('offre le bouton forker aussi sur un message utilisateur (avec messageId)', async () => {
    const fork = vi.fn().mockResolvedValue(undefined)
    await mount(
      api({
        conversations: vi.fn().mockResolvedValue([branched('branch-A-root')]),
        conversationsFork: fork
      })
    )
    await click('.conv-pick')
    const userRow = container!.querySelector('.msg.user') as HTMLElement
    const forkBtn = [...userRow.querySelectorAll('button')].find((b) =>
      /branche/i.test(b.getAttribute('aria-label') ?? '')
    )
    expect(forkBtn).toBeTruthy()
    await act(async () => (forkBtn as HTMLButtonElement).click())
    expect(fork).toHaveBeenCalledWith('A', 'm1') // forke depuis le 1er message user
  })

  it('invalide le cache live et re-rend la bonne branche APRÈS un switch réel', async () => {
    const conversations = vi
      .fn()
      .mockResolvedValueOnce([branched('branch-A-root')]) // montage : branche racine active
      .mockResolvedValue([branched('branch-A-2')]) // après switch : branche 2 active
    await mount(
      api({ conversations, conversationsSwitchBranch: vi.fn().mockResolvedValue(undefined) })
    )
    await click('.conv-pick')
    expect(container!.querySelector('.chat-scroll')!.textContent).toContain('u2') // racine
    const chips = container!.querySelectorAll('.branch-chip')
    await act(async () => (chips[1] as HTMLElement).click())
    const body = container!.querySelector('.chat-scroll')!.textContent ?? ''
    expect(body).toContain('alt')
    expect(body).not.toContain('u2') // cache live invalidé → chaîne de la branche 2
  })
})
