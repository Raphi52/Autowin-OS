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
  it('propose « Reprendre » et renvoie la TÂCHE D’ORIGINE, pas le mot « reprend »', async () => {
    const resumed: string[] = []
    render([interrompue('trouve le composant concerné')], (task) => resumed.push(task))

    const button = container.querySelector<HTMLButtonElement>('[data-testid="activity-resume"]')
    expect(button).not.toBeNull()
    await act(async () => button?.click())
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

describe('le clic a un retour visible et l’échec ne disparaît plus', () => {
  const bouton = (): HTMLButtonElement =>
    container.querySelector<HTMLButtonElement>('[data-testid="activity-resume"]')!

  it('pendant la reprise le bouton est occupé et non recliquable', async () => {
    let release: (v: { ok: boolean }) => void = () => {}
    const calls: string[] = []
    render([interrompue('une tâche')], (task) => {
      calls.push(task)
      return new Promise((resolve) => {
        release = resolve
      })
    })

    await act(async () => bouton().click())
    expect(bouton().disabled).toBe(true)
    expect(bouton().textContent).toContain('Reprise')
    // Un second clic ne relance PAS la même tâche en double.
    await act(async () => bouton().click())
    expect(calls).toEqual(['une tâche'])

    await act(async () => {
      release({ ok: true })
    })
    expect(bouton().disabled).toBe(false)
    expect(bouton().getAttribute('data-resume-error')).toBeNull()
  })

  it('un {ok:false, error} devient VISIBLE sur le bouton', async () => {
    render([interrompue('une tâche')], () =>
      Promise.resolve({ ok: false, error: 'pipeline indisponible' })
    )
    await act(async () => bouton().click())
    expect(bouton().getAttribute('data-resume-error')).toBe('pipeline indisponible')
    expect(bouton().title).toContain('pipeline indisponible')
    expect(bouton().disabled).toBe(false)
  })

  it('un rejet n’est plus silencieux', async () => {
    render([interrompue('une tâche')], () => Promise.reject(new Error('IPC coupé')))
    await act(async () => bouton().click())
    expect(bouton().getAttribute('data-resume-error')).toBe('IPC coupé')
  })
})

// Le bloc lui-même ouvre Workflows : reprendre ne doit pas déclencher cette ouverture.
describe('reprendre n’est pas « voir »', () => {
  it('cliquer Reprendre n’ouvre pas Workflows', async () => {
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
    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-testid="activity-resume"]')?.click()
    )
    expect(opened).not.toHaveBeenCalled()
  })
})
