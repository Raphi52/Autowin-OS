// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * Vu par l'utilisateur le 2026-11-12 : « je peux pas cliquer au bout des lignes sur les flèches de
 * ces blocs pour le déplier replier », devant « 4 actions terminées ». La flèche était dessinée À
 * CÔTÉ du bouton de l'en-tête, pas dedans : seul le texte réagissait, la flèche — l'endroit où l'on
 * vise naturellement pour déplier — ne faisait rien. Les autres blocs du fil (Raisonnement,
 * Orchestration, images) rendent toute leur ligne cliquable, flèche comprise.
 *
 * ENTRÉES QUI FONT ÉCHOUER UNE FAUSSE CORRECTION : la flèche ET la marge de l'en-tête doivent
 * déplier ; un clic sur le texte ne doit basculer qu'UNE fois (deux gestionnaires empilés le
 * replieraient aussitôt) ; le bouton ↗ ouvre la trace sans plier le bloc au passage.
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

type Props = Parameters<typeof AssistantActivityGroup>[0]
type Action = Props['actions'][number]
const action = (over: Partial<Action>): Action =>
  ({ kind: 'action', name: 'edit_file', args: { path: 'a.ts' }, ok: true, ...over }) as Action
const render = (props: Props): void => {
  act(() => root.render(createElement(AssistantActivityGroup, props)))
}
const etapes = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-testid="activity-steps"]')
const trouver = (selecteur: string): HTMLElement => {
  const el = container.querySelector<HTMLElement>(selecteur)
  if (!el) throw new Error(`${selecteur} absent`)
  return el
}
const cliquer = (selecteur: string): void => {
  act(() => trouver(selecteur).click())
}

describe('la flèche au bout de la ligne déplie le bloc d’actions', () => {
  it('un clic sur la flèche déplie, un second replie', () => {
    render({ actions: [action({}), action({ name: 'verify' })] })
    expect(etapes()).toBeNull()
    cliquer('[data-testid="activity-anneau"] .anneau-chevron')
    expect(etapes()).not.toBeNull()
    expect(trouver('.anneau-chevron').classList.contains('is-open')).toBe(true)
    cliquer('[data-testid="activity-anneau"] .anneau-chevron')
    expect(etapes()).toBeNull()
  })

  it('la marge de l’en-tête, entre le texte et la flèche, déplie aussi', () => {
    render({ actions: [action({})] })
    cliquer('[data-testid="activity-anneau"] > .anneau-tete')
    expect(etapes()).not.toBeNull()
  })

  it('un clic sur le texte ne bascule qu’une seule fois', () => {
    render({ actions: [action({})] })
    cliquer('[data-testid="activity-group"]')
    expect(etapes()).not.toBeNull()
    expect(trouver('[data-testid="activity-group"]').getAttribute('aria-expanded')).toBe('true')
  })

  it('le bouton ↗ ouvre la trace sans plier ni déplier le bloc', () => {
    const onOpenLiveAction = vi.fn()
    render({ actions: [action({ data: { runId: 'run-1' } })], onOpenLiveAction })
    cliquer('[data-testid="activity-open-run"]')
    expect(onOpenLiveAction).toHaveBeenCalledTimes(1)
    expect(etapes()).toBeNull()
  })
})
