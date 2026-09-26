// @vitest-environment happy-dom
/**
 * Le rail disait « bloqué » sur une règle de DoD seulement. Un run VERT, DoD complète, dont le
 * travail n'a jamais été intégré (intégration retenue ou bloquée) restait indiscernable d'un run
 * vert abouti. Ce test exige que cet état-là soit nommé à l'écran, et qu'il n'invente rien quand il
 * est absent.
 */
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ObservatoryView } from './ObservatoryView'

const run = (subject: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  subject,
  session: 'conv-1',
  path: `C:/runs/${subject}/RUN.md`,
  mtime: 1,
  summary: { status: 'green', dodTotal: 2, dodChecked: 2, journalEvents: 3, defauts: 0 },
  ...extra
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

describe('Observatory — état de publication des runs', () => {
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

  async function mount(runs: Record<string, unknown>[]): Promise<HTMLDivElement> {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: api({ listRuns: vi.fn(async () => runs) })
    })
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

  function ligne(view: HTMLDivElement, subject: string): Element | undefined {
    return [...view.querySelectorAll('[data-testid="observatory-run"]')].find((element) =>
      element.textContent?.includes(subject)
    )
  }

  it('nomme le travail RETENU d’un run vert abouti', async () => {
    const view = await mount([run('alpha', { publication: 'held', publicationLabel: 'retenu' })])
    const cible = ligne(view, 'alpha')
    expect(cible?.getAttribute('data-run-publication')).toBe('held')
    expect(cible?.textContent).toContain('retenu')
  })

  it('nomme le travail BLOQUÉ et le compte dans l’en-tête', async () => {
    const view = await mount([run('beta', { publication: 'blocked', publicationLabel: 'bloqué' })])
    expect(ligne(view, 'beta')?.getAttribute('data-run-publication')).toBe('blocked')
    const titre = [...view.querySelectorAll('.observatory-panel-title')].find((element) =>
      element.textContent?.includes('WORKFLOWS')
    )
    expect(titre?.textContent).toContain('1 non intégré(s)')
  })

  it('n’affiche aucun état de publication quand il est inconnu', async () => {
    const view = await mount([run('gamma')])
    expect(ligne(view, 'gamma')?.hasAttribute('data-run-publication')).toBe(false)
    const titre = [...view.querySelectorAll('.observatory-panel-title')].find((element) =>
      element.textContent?.includes('WORKFLOWS')
    )
    expect(titre?.textContent).not.toContain('non intégré')
  })
})
