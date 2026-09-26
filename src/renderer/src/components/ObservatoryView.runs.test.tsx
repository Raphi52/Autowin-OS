// @vitest-environment happy-dom
/**
 * Observatory porte la vue TRANSVERSALE des RUN.md.
 *
 * Le panneau Workflows du Chat a été borné à la conversation courante — ses compteurs y mélangeaient
 * les 271 RUN.md du dépôt avec les deux d'une conversation, sans dire lequel on lisait. En retirant
 * le cadrage « tous », plus AUCUNE vue globale ne subsistait : `listRuns` n'était appelée nulle part.
 * Trois garanties ici : la source globale est bien lue, les runs ouverts sont comptés, un run
 * s'ouvre. Le troisième test est celui qui compte : il échoue si la vue redevient décorative.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'

const run = (subject: string, status: string, dodChecked = 1): Record<string, unknown> => ({
  subject,
  session: 'session-x',
  path: `C:/runs/${subject}/RUN.md`,
  mtime: 1,
  summary: { status, dodTotal: 2, dodChecked, journalEvents: 3, defauts: 0 }
})

function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    conversations: vi.fn(async () => [
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 }
    ]),
    promptCalls: vi.fn(async () => []),
    promptTraceSummary: vi.fn(async () => []),
    authorizeDiagnostics: vi.fn(async () => null),
    promptTracesGlobal: vi.fn(async () => []),
    causalTrace: vi.fn(async () => []),
    brainTraces: vi.fn(async () => []),
    conversationActivity: vi.fn(async () => []),
    activitySessions: vi.fn(async () => []),
    ...overrides
  }
}

describe('Observatory — vue globale des RUN.md', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let container: HTMLDivElement | null = null

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
      root?.render(createElement(ObservatoryView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    return container
  }

  const runs = [run('alpha', 'open'), run('beta', 'green'), run('gamma', 'open')]

  it('lit la source GLOBALE et affiche chaque run', async () => {
    const listRuns = vi.fn(async () => runs)
    const view = await mount(api({ listRuns }))
    expect(listRuns).toHaveBeenCalled()
    expect(view.querySelectorAll('[data-testid="observatory-run"]')).toHaveLength(3)
  })

  // Le compteur disait « open ». Un run `green` dont la DoD reste incomplète est pourtant sans
  // issue, et il n'était compté NULLE PART : c'est le chiffre qu'on vient chercher ici.
  it('compte les runs BLOQUÉS, pas seulement ceux marqués open', async () => {
    const mixte = [...runs, run('delta', 'green', 2)]
    const view = await mount(api({ listRuns: vi.fn(async () => mixte) }))
    const titre = [...view.querySelectorAll('.observatory-panel-title')].find((element) =>
      element.textContent?.includes('WORKFLOWS')
    )
    expect(titre?.textContent).toContain('3 bloqué(s)')
  })

  it('marque un run vert mais bloqué, et laisse intact un run vert abouti', async () => {
    const view = await mount(
      api({ listRuns: vi.fn(async () => [run('beta', 'green'), run('delta', 'green', 2)]) })
    )
    const lignes = [...view.querySelectorAll('[data-testid="observatory-run"]')]
    const bloque = lignes.find((element) => element.textContent?.includes('beta'))
    const abouti = lignes.find((element) => element.textContent?.includes('delta'))
    expect(bloque?.getAttribute('data-run-blocked')).toBe('true')
    expect(bloque?.textContent).toContain('bloqué')
    expect(abouti?.getAttribute('data-run-blocked')).toBe('false')
    expect(abouti?.textContent).not.toContain('bloqué')
  })

  it('ouvre le RUN.md choisi, avec SON chemin', async () => {
    const openFolder = vi.fn(async () => undefined)
    const view = await mount(api({ listRuns: vi.fn(async () => runs), openFolder }))
    const cible = [...view.querySelectorAll('[data-testid="observatory-run"]')].find((element) =>
      element.textContent?.includes('beta')
    ) as HTMLButtonElement
    await act(async () => cible.click())
    expect(openFolder).toHaveBeenCalledWith('C:/runs/beta/RUN.md')
  })

  it('saute du run à la conversation qui l’a produit', async () => {
    const avecConversation = {
      ...run('epsilon', 'red'),
      conversationId: 'conv-2'
    }
    const conversations = vi.fn(async () => [
      { id: 'conv-1', title: 'Conversation A', provider: 'codex', updatedAt: 2 },
      { id: 'conv-2', title: 'Conversation B', provider: 'codex', updatedAt: 1 }
    ])
    const promptCalls = vi.fn(async () => [])
    const view = await mount(
      api({ conversations, promptCalls, listRuns: vi.fn(async () => [avecConversation]) })
    )
    const saut = view.querySelector(
      '[data-testid="observatory-run-conversation"]'
    ) as HTMLButtonElement
    expect(saut.getAttribute('data-conversation-id')).toBe('conv-2')
    await act(async () => saut.click())
    // La vue est bien passée sur conv-2 : ses sources ont été rechargées POUR cette conversation.
    expect(promptCalls).toHaveBeenCalledWith('conv-2')
  })

  it('aucun saut proposé quand le run n’est rattaché à aucune conversation', async () => {
    const view = await mount(api({ listRuns: vi.fn(async () => runs) }))
    expect(view.querySelectorAll('[data-testid="observatory-run-conversation"]')).toHaveLength(0)
  })

  it('une source absente ne casse pas le rail', async () => {
    // `listRuns` optionnelle : la vue tourne aussi sur un preload plus ancien.
    const view = await mount(api())
    expect(view.querySelectorAll('[data-testid="observatory-run"]')).toHaveLength(0)
  })
})
