// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * B3-γ porté au FIL D'ACTIVITÉ du chat (et non au seul RunProgress) : la TEINTE de statut est
 * portée par la CARTE, pas par le seul point. Sans `data-state` sur `.activity-group`, le CSS ne
 * peut décliner aucune teinte — c'est exactement l'écart constaté par l'utilisateur : « quand tu
 * réfléchis tu fais pas ce qu'on s'est fait chier à faire converger ».
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

function render(actions: Action[]): void {
  act(() => root.render(createElement(AssistantActivityGroup, { actions })))
}
// Une orchestration seule est une CAPSULE depuis conv-194 (2026-10-10) : elle porte le meme
// `data-state` que la carte, c'est lui que le theme et ces tests lisent.
const carte = (): HTMLElement | null =>
  container.querySelector('.activity-anneau, .thinking-block--orchestration')

const action = (over: Partial<Action>): Action =>
  ({ kind: 'action', name: 'orchestrate', args: { task: 't' }, ...over }) as Action

describe('B3-γ dans le fil d activité : la carte porte la teinte du statut', () => {
  it('marque la carte en echec', () => {
    render([action({ ok: false })])
    expect(carte()?.getAttribute('data-state')).toBe('failed')
  })

  it('marque la carte en cours', () => {
    render([action({ ok: undefined })])
    expect(carte()?.getAttribute('data-state')).toBe('running')
  })

  it('marque la carte interrompue', () => {
    render([action({ ok: undefined, interrupted: true })])
    expect(carte()?.getAttribute('data-state')).toBe('interrupted')
  })

  it('marque la carte terminee', () => {
    render([action({ ok: true })])
    expect(carte()?.getAttribute('data-state')).toBe('done')
  })

  /**
   * L'ENTRÉE QUI FERAIT ÉCHOUER CE TEST SI LA CORRECTION ÉTAIT FAUSSE : une carte en échec dont
   * l'état serait tiré du seul `ok === undefined` (donc 'running'), ou un `data-state` constant.
   * Ce cas mélange une action réussie ET une échouée : l'échec doit primer.
   */
  it('l echec prime sur une action reussie du meme groupe', () => {
    render([action({ ok: true }), action({ ok: false })])
    expect(carte()?.getAttribute('data-state')).toBe('failed')
  })

  /*
   * La TEINTE n'est plus portee par le fond de la carte (B3-γ) : depuis conv-904 (2026-10-12) le
   * verdict se lit dans l'ANNEAU d'arcs et la legende, l'etat du groupe dans le reflet du cadre.
   * Le data-state ci-dessus reste le contrat ; le dessin est verrouille par anneau-activite.test.tsx.
   */
})
