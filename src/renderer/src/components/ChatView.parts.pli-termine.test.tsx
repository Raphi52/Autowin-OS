// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * DEMANDE du 2026-09-01 : « les blocs actions terminé doivent tous être pliés à l'origine et c'est
 * le user qui les déplie si besoin ».
 *
 * ENTREES QUI FONT ECHOUER UNE FAUSSE CORRECTION : un groupe TERMINE (plie), un groupe EN COURS
 * (deplie — c'est la seule chose a regarder pendant le vol), et un groupe EN ERREUR (deplie).
 * Un defaut « toujours plie » passerait le premier cas et echouerait les deux autres.
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

type Action = Parameters<typeof AssistantActivityGroup>[0]['actions'][number]
const action = (over: Partial<Action>): Action =>
  ({ kind: 'action', name: 'edit_file', args: { path: 'a.ts' }, ...over }) as Action
const render = (actions: Action[]): void => {
  act(() => root.render(createElement(AssistantActivityGroup, { actions })))
}
const etapes = (): HTMLElement | null =>
  container.querySelector<HTMLElement>('[data-testid="activity-steps"]')
const entete = (): HTMLButtonElement => {
  const el = container.querySelector<HTMLButtonElement>('[data-testid="activity-group"]')
  if (!el) throw new Error('activity-group absent')
  return el
}

describe('pli par defaut des groupes d activite', () => {
  it('un groupe TERMINE arrive plie', () => {
    render([action({ ok: true }), action({ name: 'verify', ok: true })])
    expect(etapes()).toBeNull()
    expect(entete().getAttribute('aria-expanded')).toBe('false')
  })

  it('un groupe EN COURS reste deplie', () => {
    render([action({ ok: undefined })])
    expect(etapes()).not.toBeNull()
    expect(entete().getAttribute('aria-expanded')).toBe('true')
  })

  it('un groupe EN ERREUR reste deplie', () => {
    render([action({ ok: false })])
    expect(etapes()).not.toBeNull()
  })

  it('une action INTERROMPUE reste depliee', () => {
    render([action({ ok: undefined, interrupted: true } as Partial<Action>)])
    expect(etapes()).not.toBeNull()
  })

  it('le clic de l utilisateur deplie le groupe termine, un second le replie', () => {
    render([action({ ok: true })])
    act(() => entete().click())
    expect(etapes()).not.toBeNull()
    act(() => entete().click())
    expect(etapes()).toBeNull()
  })
})
