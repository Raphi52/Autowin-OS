// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * DEMANDE du 20/08 : « quand je clique sur une action avec erreur je veux que ça déplie le pourquoi ».
 *
 * Vécu sur conv-1334 : la pastille affichait « bloqué par le gate — Statut "red" : la clôture a été
 * refusée en amont. · », tronquée, et le SECOND motif — la DoD non tenue, qui dit ce qu'il aurait
 * fallu produire — n'était visible nulle part. Le clic renvoyait vers Workflows, c'est-à-dire hors
 * du fil, pour une information qui tient en deux lignes.
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

const actionBloquee = {
  kind: 'action' as const,
  name: 'orchestrate',
  ok: false,
  args: { task: 'renommer' },
  data: {
    gateBlocked: true,
    runId: 'run-42',
    gateReasons: [
      'Statut "red" : la clôture a été refusée en amont.',
      'DoD non tenue : « Mutation demandee produite avec une preuve executable ».'
    ]
  }
}

function render(onOpenLiveAction = vi.fn()): void {
  act(() =>
    root.render(
      createElement(AssistantActivityGroup, {
        actions: [actionBloquee] as never,
        onOpenLiveAction
      })
    )
  )
}

const clic = (selector: string): void => {
  const cible = container.querySelector<HTMLButtonElement>(selector)
  if (!cible) throw new Error(`${selector} absent`)
  act(() => cible.click())
}

describe('AssistantActivityGroup — le clic déplie le pourquoi', () => {
  it('replié par défaut : le fil reste lisible', () => {
    render()
    expect(container.querySelector('[data-testid="activity-why"]')).toBeNull()
  })

  it('le clic déplie TOUS les motifs, entiers', () => {
    render()
    clic('[data-testid="activity-group"]')
    const deplie = container.querySelector('[data-testid="activity-why"]')
    expect(deplie).not.toBeNull()
    expect(deplie?.textContent).toContain('la clôture a été refusée en amont')
    // Le motif que la pastille tronquée n'affichait NULLE PART.
    expect(deplie?.textContent).toContain('Mutation demandee produite avec une preuve executable')
  })

  it('un second clic replie', () => {
    render()
    clic('[data-testid="activity-group"]')
    clic('[data-testid="activity-group"]')
    expect(container.querySelector('[data-testid="activity-why"]')).toBeNull()
  })

  it('le chemin vers Workflows n’est pas perdu : il a son propre bouton', () => {
    const onOpenLiveAction = vi.fn()
    render(onOpenLiveAction)
    clic('[data-testid="activity-open-run"]')
    expect(onOpenLiveAction).toHaveBeenCalledWith('history', 'run-42')
  })
})
