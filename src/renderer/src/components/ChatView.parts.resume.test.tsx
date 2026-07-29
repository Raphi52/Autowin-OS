// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantActivityGroup, interruptedTask } from './ChatView.parts'
import type { ChatActionPart } from './chat-view-model'

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

function render(actions: ChatActionPart[], onResume?: (task: string) => void): void {
  act(() => root.render(createElement(AssistantActivityGroup, { actions, onResume })))
}

const interrompue = (task?: string): ChatActionPart =>
  ({
    kind: 'action',
    name: 'orchestrate',
    interrupted: true,
    ...(task ? { args: { task } } : {})
  }) as ChatActionPart

describe('reprendre une action interrompue sans la retaper', () => {
  it('propose « Reprendre » et renvoie la TÂCHE D’ORIGINE, pas le mot « reprend »', () => {
    const resumed: string[] = []
    render([interrompue('trouve le composant concerné')], (task) => resumed.push(task))

    const button = container.querySelector<HTMLButtonElement>('[data-testid="activity-resume"]')
    expect(button).not.toBeNull()
    act(() => button?.click())
    // C'est la tâche d'origine qui repart : elle seule retombe sur l'acquis persisté du run mort.
    expect(resumed).toEqual(['trouve le composant concerné'])
  })

  it('le bouton vit DANS la barre, à droite — pas en pleine largeur en dessous', () => {
    render([interrompue('une tâche')], () => undefined)
    const barre = container.querySelector('.activity-group')
    const bouton = container.querySelector('[data-testid="activity-resume"]')
    expect(barre?.contains(bouton ?? null)).toBe(true)
    // Il vient APRÈS la zone « voir », donc à droite dans une barre en flex.
    expect(bouton?.previousElementSibling?.getAttribute('data-testid')).toBe('activity-group')
  })

  it('aucun bouton si rien n’est interrompu', () => {
    const finie = { kind: 'action', name: 'orchestrate', ok: true } as ChatActionPart
    render([finie], () => undefined)
    expect(container.querySelector('[data-testid="activity-resume"]')).toBeNull()
  })

  it('aucun bouton si la tâche est introuvable — mieux vaut rien que rien promettre', () => {
    render([interrompue()], () => undefined)
    expect(container.querySelector('[data-testid="activity-resume"]')).toBeNull()
  })

  it('aucun bouton sans canal de reprise', () => {
    render([interrompue('une tâche')], undefined)
    expect(container.querySelector('[data-testid="activity-resume"]')).toBeNull()
  })

  it('interruptedTask prend la PREMIÈRE action interrompue qui porte une tâche', () => {
    expect(interruptedTask([interrompue(), interrompue('la bonne'), interrompue('la suivante')])).toBe(
      'la bonne'
    )
    expect(interruptedTask([interrompue('   ')])).toBeUndefined()
  })
})

// Le bloc lui-même ouvre Workflows : reprendre ne doit pas déclencher cette ouverture.
describe('reprendre n’est pas « voir »', () => {
  it('cliquer Reprendre n’ouvre pas Workflows', () => {
    const opened = vi.fn()
    act(() =>
      root.render(
        createElement(AssistantActivityGroup, {
          actions: [interrompue('une tâche')],
          onResume: () => undefined,
          onOpenLiveAction: opened
        })
      )
    )
    act(() => container.querySelector<HTMLButtonElement>('[data-testid="activity-resume"]')?.click())
    expect(opened).not.toHaveBeenCalled()
  })
})
