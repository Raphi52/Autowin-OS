// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KnowledgeInboxPanel, type InboxCandidateView } from './KnowledgeInboxPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

const flush = (): Promise<void> =>
  act(async () => {
    for (let index = 0; index < 8; index += 1) await Promise.resolve()
  })

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function candidate(over: Partial<InboxCandidateView> = {}): InboxCandidateView {
  return {
    id: 'inbox/a',
    file: 'C:/brain/inbox/a.md',
    title: 'Promotion humaine',
    body: 'corps du candidat',
    bodyTruncated: false,
    nearDuplicates: [],
    warnings: [],
    ...over
  }
}

function mockApi(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listInbox: vi.fn().mockResolvedValue([candidate()]),
    readInboxCandidateBody: vi
      .fn()
      .mockResolvedValue({ id: 'inbox/a', body: 'corps complet du candidat' }),
    promoteInbox: vi.fn().mockResolvedValue({ ok: true, from: 'inbox/a', to: 'knowledge/a' }),
    rejectInbox: vi.fn().mockResolvedValue({ ok: true, from: 'inbox/a', to: '.trash/a' }),
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

async function render(props: Record<string, unknown> = {}): Promise<void> {
  await act(async () => {
    root.render(<KnowledgeInboxPanel brainPath="C:/brain" {...props} />)
  })
  await flush()
}

describe('KnowledgeInboxPanel — la promotion humaine a enfin une surface', () => {
  it('liste les candidats de inbox/ pour la racine sélectionnée', async () => {
    const api = mockApi()
    await render()
    expect(api.listInbox).toHaveBeenCalledWith('C:/brain')
    expect(container.textContent).toContain('Promotion humaine')
    expect(container.textContent).toContain('1 candidat')
  })

  it('retire les anciennes decisions des le debut d’un rechargement qui echoue', async () => {
    const api = mockApi({
      listInbox: vi
        .fn()
        .mockResolvedValueOnce([candidate({ title: 'ANCIEN-CANDIDAT' })])
        .mockRejectedValueOnce(new Error('LISTE-INDISPONIBLE'))
    })
    await render()
    expect(container.textContent).toContain('ANCIEN-CANDIDAT')

    await act(async () =>
      [...container.querySelectorAll('button')]
        .find((button) => button.textContent?.includes('Actualiser'))
        ?.click()
    )
    await flush()

    expect(api.listInbox).toHaveBeenCalledTimes(2)
    expect(container.textContent).toContain('LISTE-INDISPONIBLE')
    expect(container.textContent).not.toContain('ANCIEN-CANDIDAT')
    expect(container.querySelector('button.is-promote')).toBeNull()
  })

  it('affiche quand la comparaison canonique est incomplete', async () => {
    mockApi({
      listInbox: vi.fn().mockResolvedValue([
        candidate({
          warnings: ['Comparaison incomplète : knowledge/enorme ignorée']
        } as Partial<InboxCandidateView> & { warnings: string[] })
      ])
    })
    await render()
    expect(container.textContent).toContain('Comparaison incomplète')
    expect(container.textContent).toContain('Promotion humaine')
  })

  it('ne lit le corps complet qu’à l’ouverture d’une fiche tronquée', async () => {
    const api = mockApi({
      listInbox: vi
        .fn()
        .mockResolvedValue([
          candidate({ body: 'extrait', bodyTruncated: true, title: 'CORPS-LAZY' })
        ]),
      readInboxCandidateBody: vi
        .fn()
        .mockResolvedValue({ id: 'inbox/a', body: 'CORPS-COMPLET-LAZY' })
    })
    await render()
    expect(api.readInboxCandidateBody).not.toHaveBeenCalled()

    await act(async () => container.querySelector<HTMLElement>('details > summary')?.click())
    await flush()

    expect(api.readInboxCandidateBody).toHaveBeenCalledWith('C:/brain', 'inbox/a')
    expect(container.textContent).toContain('CORPS-COMPLET-LAZY')
  })

  it('Promouvoir appelle le main avec l’id, recharge et demande la réindexation', async () => {
    const api = mockApi()
    const onIndexChanged = vi.fn()
    await render({ onIndexChanged })
    const promote = container.querySelector<HTMLButtonElement>('button.is-promote')
    expect(promote).not.toBeNull()
    await act(async () => promote?.click())
    await flush()
    expect(api.promoteInbox).toHaveBeenCalledWith('C:/brain', 'inbox/a')
    expect(api.rejectInbox).not.toHaveBeenCalled()
    // Rechargée : un premier appel au montage, un second après la décision.
    expect(api.listInbox).toHaveBeenCalledTimes(2)
    expect(onIndexChanged).toHaveBeenCalledTimes(1)
    expect(onIndexChanged).toHaveBeenCalledWith('C:/brain')
  })

  it('Rejeter appelle le canal de rejet, jamais celui de promotion', async () => {
    const api = mockApi()
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('button.is-reject')?.click())
    await flush()
    expect(api.rejectInbox).toHaveBeenCalledWith('C:/brain', 'inbox/a')
    expect(api.promoteInbox).not.toHaveBeenCalled()
  })

  it('garde chaque candidat occupé jusqu’à la fin de sa propre décision', async () => {
    const pendingA = deferred<{ ok: boolean }>()
    const pendingB = deferred<{ ok: boolean }>()
    const api = mockApi({
      listInbox: vi
        .fn()
        .mockResolvedValue([
          candidate({ id: 'inbox/a', title: 'CANDIDAT-A' }),
          candidate({ id: 'inbox/b', title: 'CANDIDAT-B' })
        ]),
      promoteInbox: vi.fn((_brainPath: string, id: string) =>
        id === 'inbox/a' ? pendingA.promise : pendingB.promise
      )
    })
    await render()
    const promote = (id: string): HTMLButtonElement | null =>
      container.querySelector(`[data-candidate-id="${id}"] button.is-promote`)

    await act(async () => promote('inbox/a')?.click())
    await act(async () => promote('inbox/b')?.click())
    expect(promote('inbox/a')?.disabled).toBe(true)
    expect(promote('inbox/b')?.disabled).toBe(true)
    await act(async () => promote('inbox/a')?.click())
    expect(api.promoteInbox.mock.calls.map(([, id]) => id)).toEqual(['inbox/a', 'inbox/b'])

    pendingA.resolve({ ok: true })
    await flush()
    expect(promote('inbox/a')?.disabled).toBe(false)
    expect(promote('inbox/b')?.disabled).toBe(true)

    pendingB.resolve({ ok: true })
    await flush()
    expect(promote('inbox/b')?.disabled).toBe(false)
  })

  it("un succès B n'efface pas l'échec concurrent de A", async () => {
    let rejectA!: (cause: Error) => void
    const pendingA = new Promise<{ ok: boolean }>((_resolve, reject) => {
      rejectA = reject
    })
    const pendingB = deferred<{ ok: boolean }>()
    mockApi({
      listInbox: vi
        .fn()
        .mockResolvedValue([
          candidate({ id: 'inbox/a', title: 'CANDIDAT-A' }),
          candidate({ id: 'inbox/b', title: 'CANDIDAT-B' })
        ]),
      promoteInbox: vi.fn((_brainPath: string, id: string) =>
        id === 'inbox/a' ? pendingA : pendingB.promise
      )
    })
    await render()
    const promote = (id: string): HTMLButtonElement | null =>
      container.querySelector(`[data-candidate-id="${id}"] button.is-promote`)
    await act(async () => promote('inbox/a')?.click())
    await act(async () => promote('inbox/b')?.click())

    rejectA(new Error('A_FAIL'))
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('A_FAIL')

    pendingB.resolve({ ok: true })
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('A_FAIL')
  })

  it('un échec de décision s’affiche comme erreur — jamais un succès silencieux', async () => {
    const api = mockApi({
      promoteInbox: vi.fn().mockRejectedValue(new Error('brain vault hors périmètre autorisé'))
    })
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('button.is-promote')?.click())
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('hors périmètre')
    // La liste n'a PAS été rechargée : rien n'a bougé.
    expect(api.listInbox).toHaveBeenCalledTimes(1)
  })

  it('affiche source, âge et sha OBSOLÈTE par fiche (item 5)', async () => {
    mockApi({
      listInbox: vi.fn().mockResolvedValue([
        candidate({
          depositedAt: '2026-08-01',
          ageDays: 9,
          source: {
            locator: 'git:src/main/index.ts@deadbeef',
            scheme: 'git',
            path: 'src/main/index.ts',
            sha: 'deadbeef',
            shaState: 'stale'
          }
        })
      ])
    })
    await render()
    expect(container.textContent).toContain('git:src/main/index.ts@deadbeef')
    expect(container.textContent).toContain('sha obsolète')
    expect(container.textContent).toContain('déposé il y a 9 jours')
    expect(container.querySelector('[data-sha-state="stale"]')).not.toBeNull()
  })

  it('distingue « sha non vérifié » de « sha à jour »', async () => {
    mockApi({
      listInbox: vi.fn().mockResolvedValue([
        candidate({
          source: { locator: 'git:x.ts@abc', scheme: 'git', sha: 'abc', shaState: 'unknown' }
        })
      ])
    })
    await render()
    expect(container.textContent).toContain('sha non vérifié')
    expect(container.textContent).toContain('sha non vérifié localement')
    expect(container.textContent).not.toContain('dépôt introuvable')
    expect(container.textContent).not.toContain('sha à jour')
  })

  it('signale un locator non traçable sans masquer la fiche', async () => {
    mockApi({
      listInbox: vi.fn().mockResolvedValue([
        candidate({
          source: {
            locator: 'C:\\ged2\\note.md',
            problem: 'préfixe manquant devant un chemin',
            shaState: 'absent'
          }
        })
      ])
    })
    await render()
    expect(container.textContent).toContain('préfixe manquant')
    expect(container.textContent).toContain('Promotion humaine')
  })

  it('surface le quasi-jumeau et dit s’il est DÉJÀ canonique (item 6)', async () => {
    mockApi({
      listInbox: vi.fn().mockResolvedValue([
        candidate({
          nearDuplicates: [
            { id: 'knowledge/budget', similarity: 0.91, zone: 'knowledge' },
            { id: 'inbox/b', similarity: 0.85, zone: 'inbox' }
          ],
          nearDuplicatesOmitted: { inbox: 12, knowledge: 3 }
        })
      ])
    })
    await render()
    expect(container.textContent).toContain('doublon probable 91 %')
    expect(container.textContent).toContain('DÉJÀ dans le savoir canonique')
    expect(container.textContent).toContain('autre candidat en attente')
    expect(container.textContent).toContain('Non affichés : 12 inbox · 3 knowledge')
    expect(container.textContent).toContain('meilleur doublon canonique reste toujours visible')
    // Le proxy lexical est annoncé comme tel, pas comme un verdict.
    expect(container.textContent).toContain('pas un verdict')
  })

  it('n’invente aucune garantie canonique quand seules des fiches inbox sont omises', async () => {
    mockApi({
      listInbox: vi.fn().mockResolvedValue([
        candidate({
          nearDuplicates: [{ id: 'inbox/b', similarity: 0.91, zone: 'inbox' }],
          nearDuplicatesOmitted: { inbox: 1, knowledge: 0 }
        })
      ])
    })

    await render()

    expect(container.textContent).toContain('Non affichés : 1 inbox · 0 knowledge')
    expect(container.textContent).not.toContain('meilleur doublon canonique')
  })

  it('une boîte vide se dit vide, et un échec de lecture se dit échec', async () => {
    mockApi({ listInbox: vi.fn().mockResolvedValue([]) })
    await render()
    expect(container.textContent).toContain('Aucun candidat en attente')

    mockApi({ listInbox: vi.fn().mockRejectedValue(new Error('serveur de fichiers injoignable')) })
    await act(async () => root.render(<KnowledgeInboxPanel brainPath="C:/autre" />))
    await flush()
    expect(container.querySelector('[role="alert"]')?.textContent).toContain('injoignable')
  })

  it('sans brain sélectionné, aucun appel IPC n’est tenté', async () => {
    const api = mockApi()
    await render({ brainPath: '' })
    expect(api.listInbox).not.toHaveBeenCalled()
  })

  it('efface les candidats de A pendant que la lecture de B est encore suspendue', async () => {
    const pendingB = deferred<InboxCandidateView[]>()
    mockApi({
      listInbox: vi.fn((brainPath: string) =>
        brainPath === 'C:/A'
          ? Promise.resolve([candidate({ id: 'inbox/a', title: 'CANDIDAT-A' })])
          : pendingB.promise
      )
    })

    await render({ brainPath: 'C:/A' })
    expect(container.textContent).toContain('CANDIDAT-A')

    await act(async () => root.render(<KnowledgeInboxPanel brainPath="C:/B" />))
    expect(container.textContent).not.toContain('CANDIDAT-A')

    pendingB.resolve([candidate({ id: 'inbox/b', title: 'CANDIDAT-B' })])
    await flush()
    expect(container.textContent).toContain('CANDIDAT-B')
  })

  it('ignore une lecture de A qui se termine après que B est déjà affiché', async () => {
    const pendingA = deferred<InboxCandidateView[]>()
    mockApi({
      listInbox: vi.fn((brainPath: string) =>
        brainPath === 'C:/A'
          ? pendingA.promise
          : Promise.resolve([candidate({ id: 'inbox/b', title: 'CANDIDAT-B' })])
      )
    })

    await render({ brainPath: 'C:/A' })
    await act(async () => root.render(<KnowledgeInboxPanel brainPath="C:/B" />))
    await flush()
    expect(container.textContent).toContain('CANDIDAT-B')

    pendingA.resolve([candidate({ id: 'inbox/a', title: 'CANDIDAT-A' })])
    await flush()
    expect(container.textContent).toContain('CANDIDAT-B')
    expect(container.textContent).not.toContain('CANDIDAT-A')
  })

  it.each(['promote', 'reject'] as const)(
    'ignore une décision %s de A qui se termine après le passage à B',
    async (action) => {
      const pendingDecision = deferred<{ ok: boolean }>()
      const onIndexChanged = vi.fn()
      const api = mockApi({
        listInbox: vi.fn((brainPath: string) =>
          Promise.resolve([
            candidate({
              id: brainPath === 'C:/A' ? 'inbox/a' : 'inbox/b',
              title: brainPath === 'C:/A' ? 'CANDIDAT-A' : 'CANDIDAT-B'
            })
          ])
        ),
        promoteInbox:
          action === 'promote'
            ? vi.fn(() => pendingDecision.promise)
            : vi.fn().mockResolvedValue({}),
        rejectInbox:
          action === 'reject' ? vi.fn(() => pendingDecision.promise) : vi.fn().mockResolvedValue({})
      })

      await render({ brainPath: 'C:/A', onIndexChanged })
      await act(async () =>
        container
          .querySelector<HTMLButtonElement>(
            action === 'promote' ? 'button.is-promote' : 'button.is-reject'
          )
          ?.click()
      )
      await act(async () =>
        root.render(<KnowledgeInboxPanel brainPath="C:/B" onIndexChanged={onIndexChanged} />)
      )
      await flush()
      expect(container.textContent).toContain('CANDIDAT-B')

      pendingDecision.resolve({ ok: true })
      await flush()

      expect(container.textContent).toContain('CANDIDAT-B')
      expect(container.textContent).not.toContain('CANDIDAT-A')
      expect(api.listInbox).toHaveBeenCalledTimes(2)
      expect(onIndexChanged).not.toHaveBeenCalled()
    }
  )
})
