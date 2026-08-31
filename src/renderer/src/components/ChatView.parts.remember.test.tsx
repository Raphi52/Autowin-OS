// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * DEMANDE du 20/08 : « quand je clique sur 1 action terminée remember ça doit déplier ce que ça a
 * remember ». Le bloc était INERTE sur un remember réussi : pas de `why` (aucun résumé d'issue pour
 * cette commande), et `localActionDetails` ignorait `fact`/`detail`, donc rien à déplier non plus.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const rememberReussi = {
  kind: 'action' as const,
  name: 'remember',
  ok: true,
  args: { title: 'Famine du chat' },
  data: {
    allowed: true,
    stored: true,
    detail: 'deposé au Brain (inbox)',
    fact: {
      title: 'Famine du chat : waitForInteractiveAccess',
      body: 'waitForInteractiveAccess() attend sans timeout que releaseIdleLease() soit appelé.',
      type: 'lesson',
      scope: 'project',
      confidence: 'high',
      tags: ['chat']
    }
  }
}

function render(): void {
  act(() =>
    root.render(createElement(AssistantActivityGroup, { actions: [rememberReussi] as never }))
  )
}

const clicBloc = (): void => {
  const bloc = container.querySelector<HTMLButtonElement>('[data-testid="activity-group"]')
  if (!bloc) throw new Error('activity-group absent')
  act(() => bloc.click())
}

const bloc = (): HTMLElement => {
  const el = container.querySelector<HTMLElement>('[data-testid="activity-group"]')
  if (!el) throw new Error('activity-group absent')
  return el
}

const etapes = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-testid="activity-steps"]')

const detailEtape = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-testid="activity-step-detail"]')

describe('clic sur une action remember terminée', () => {
  it('le bloc est ACTIONNABLE (plus aria-disabled)', () => {
    render()
    expect(bloc().getAttribute('aria-disabled')).not.toBe('true')
    expect(bloc().getAttribute('aria-expanded')).toBe('true')
  })

  it('le contenu retenu est PLIÉ au départ, l’étape visible', () => {
    render()
    expect(etapes()).not.toBeNull()
    expect(detailEtape()).toBeNull()
  })

  it('le déplié se fait sur l’ÉTAGE, pas sur un second bloc', () => {
    render()
    const toggle = container.querySelector<HTMLElement>('[data-testid="activity-step-toggle"]')
    expect(toggle).not.toBeNull()
    act(() => toggle!.click())
    expect(detailEtape()).not.toBeNull()
    expect(container.textContent).toContain('releaseIdleLease')
    expect(container.textContent).toContain('deposé au Brain')
  })

  it('le chevron d’en-tête CACHE les lignes d’étapes, et rien d’autre', () => {
    render()
    clicBloc()
    expect(etapes()).toBeNull()
    expect(bloc().getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('[data-testid="activity-local-details"]')).toBeNull()
    clicBloc()
    expect(etapes()).not.toBeNull()
  })
})
