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

function candidate(over: Partial<InboxCandidateView> = {}): InboxCandidateView {
  return {
    id: 'inbox/a',
    file: 'C:/brain/inbox/a.md',
    title: 'Promotion humaine',
    body: 'corps du candidat',
    nearDuplicates: [],
    ...over
  }
}

function mockApi(over: Record<string, unknown> = {}): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    listInbox: vi.fn().mockResolvedValue([candidate()]),
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
  })

  it('Rejeter appelle le canal de rejet, jamais celui de promotion', async () => {
    const api = mockApi()
    await render()
    await act(async () => container.querySelector<HTMLButtonElement>('button.is-reject')?.click())
    await flush()
    expect(api.rejectInbox).toHaveBeenCalledWith('C:/brain', 'inbox/a')
    expect(api.promoteInbox).not.toHaveBeenCalled()
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
          ]
        })
      ])
    })
    await render()
    expect(container.textContent).toContain('doublon probable 91 %')
    expect(container.textContent).toContain('DÉJÀ dans le savoir canonique')
    expect(container.textContent).toContain('autre candidat en attente')
    // Le proxy lexical est annoncé comme tel, pas comme un verdict.
    expect(container.textContent).toContain('pas un verdict')
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
})
