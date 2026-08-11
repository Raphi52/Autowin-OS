// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeInboxPanel, type InboxCandidateView } from './KnowledgeInboxPanel'

/**
 * CHANTIER 3 — la boucle `remember -> promotion -> trouvable` était coupée : le candidat disparaissait
 * de la liste et RIEN ne disait si le savoir était déjà interrogeable. CHANTIER 5 — une lecture de la
 * boîte qui échoue n'offrait aucun réessai.
 */

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })

function candidate(over: Partial<InboxCandidateView> = {}): InboxCandidateView {
  return {
    id: 'inbox/a',
    file: 'C:/brain/inbox/a.md',
    title: 'Promotion humaine',
    body: 'corps',
    bodyTruncated: false,
    nearDuplicates: [],
    warnings: [],
    ...over
  }
}

function mockApi(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listInbox: vi.fn().mockResolvedValue([candidate()]),
    promoteInbox: vi.fn().mockResolvedValue({ ok: true }),
    rejectInbox: vi.fn().mockResolvedValue({ ok: true }),
    ...over
  } as Record<string, ReturnType<typeof vi.fn>>
  ;(globalThis as unknown as { window: { api: unknown } }).window.api = api
  return api
}

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  vi.restoreAllMocks()
})

describe('KnowledgeInboxPanel — la boucle promotion → trouvable est explicite', () => {
  it('annonce « réindexation en cours » puis « trouvable » après une promotion', async () => {
    mockApi()
    let releaseIndex: (() => void) | undefined
    const onIndexChanged = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseIndex = resolve
        })
    )
    await act(async () => {
      root.render(<KnowledgeInboxPanel brainPath="C:/brain" onIndexChanged={onIndexChanged} />)
    })
    await flush()

    await act(async () => container.querySelector<HTMLButtonElement>('button.is-promote')?.click())
    await flush()

    const pending = container.querySelector('[data-index-state="reindexing"]')
    expect(pending).not.toBeNull()
    expect(pending?.textContent).toContain('éindexation en cours')

    await act(async () => {
      releaseIndex?.()
    })
    await flush()

    const done = container.querySelector('[data-index-state="searchable"]')
    expect(done).not.toBeNull()
    expect(done?.textContent).toContain('trouvable')
  })

  it('un rejet annonce aussi la fin de la réindexation', async () => {
    mockApi()
    await act(async () => {
      root.render(
        <KnowledgeInboxPanel
          brainPath="C:/brain"
          onIndexChanged={vi.fn().mockResolvedValue(undefined)}
        />
      )
    })
    await flush()
    await act(async () => container.querySelector<HTMLButtonElement>('button.is-reject')?.click())
    await flush()
    expect(container.querySelector('[data-index-state="searchable"]')?.textContent).toContain(
      'trouvable'
    )
  })

  it('une lecture de la boîte en échec offre un réessai ciblé', async () => {
    const listInbox = vi
      .fn()
      .mockRejectedValueOnce(new Error('canal fermé'))
      .mockResolvedValueOnce([candidate()])
    mockApi({ listInbox })
    await act(async () => {
      root.render(<KnowledgeInboxPanel brainPath="C:/brain" />)
    })
    await flush()
    expect(container.querySelector('.knowledge-inbox__error')?.textContent).toContain('canal fermé')

    const retry = container.querySelector<HTMLButtonElement>('.knowledge-inbox__retry')
    expect(retry).not.toBeNull()
    await act(async () => retry?.click())
    await flush()
    expect(listInbox).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('Promotion humaine')
    expect(container.querySelector('.knowledge-inbox__error')).toBeNull()
  })
})
