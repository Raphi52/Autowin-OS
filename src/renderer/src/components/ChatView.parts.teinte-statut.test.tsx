// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
const carte = (): HTMLElement | null => container.querySelector('.activity-group')

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

  it('la feuille decline la teinte de la carte par statut, pas seulement le point', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ChatView.css'), 'utf8')
    // Lecture sans regex : on extrait le corps de chaque regle par decoupage, ce qui ne peut pas
    // etre affaibli par une classe de caracteres mal echappee.
    const corps = (selecteur: string): string | null => {
      const i = css.indexOf(selecteur + ' {')
      if (i < 0) return null
      return css.slice(i + selecteur.length + 2, css.indexOf('}', i))
    }
    for (const etat of ['failed', 'running', 'interrupted']) {
      const regle = corps(".activity-group[data-state='" + etat + "']")
      expect(regle, 'regle manquante pour ' + etat).not.toBeNull()
      expect(regle!).toMatch(/border-left-color|border-color/)
      expect(regle!).toMatch(/background/)
    }
    // La carte elle-meme doit porter un bord : sans lui, decliner sa couleur ne montre rien.
    expect(corps('.activity-group')).toMatch(/border-left:/)
  })

  /**
   * CASCADE REELLE. Le theme `cosmic-outline` repeint `.activity-group` avec une specificite
   * (0,2,0) SUPERIEURE a `.activity-group` (0,1,0) de ChatView.css : sans regle teintee DANS le
   * theme, B3-γ serait ecrit mais invisible a l'ecran. C'est exactement le faux vert qu'un test qui
   * ne lit que ChatView.css laisse passer.
   */
  it('le theme cosmic-outline decline lui aussi la teinte, sinon il ecrase la carte', () => {
    const theme = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '..', 'assets', 'cosmic-outline.css'),
      'utf8'
    )
    const corps = (selecteur: string): string | null => {
      const i = theme.indexOf(selecteur + ' {')
      if (i < 0) return null
      return theme.slice(i + selecteur.length + 2, theme.indexOf('}', i))
    }
    for (const etat of ['failed', 'running', 'interrupted']) {
      const regle = corps(".cosmic-outline .activity-group[data-state='" + etat + "']")
      expect(regle, 'teinte de theme manquante pour ' + etat).not.toBeNull()
      expect(regle!).toMatch(/border-left-color/)
      expect(regle!).toMatch(/background/)
    }
  })
})
