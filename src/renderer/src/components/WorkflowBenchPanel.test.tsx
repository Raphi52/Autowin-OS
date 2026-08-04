// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowBenchPanel } from './WorkflowBenchPanel'

let container: HTMLDivElement
let root: Root
let benchRun: ReturnType<typeof vi.fn>
let detach: ReturnType<typeof vi.fn>
let progressListener: ((p: { done: number; total: number; label: string }) => void) | undefined

const rapport = {
  objective: 'ranger',
  rows: [
    { profileId: 'vif', profileName: 'Vif', green: true, comparableCostUsd: 1 },
    { profileId: 'lent', profileName: 'Lent', green: true, comparableCostUsd: 3 }
  ],
  recommendedProfileId: 'vif',
  rationale: 'Vif aboutit pour 1.00 $'
}

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  benchRun = vi.fn().mockResolvedValue(rapport)
  detach = vi.fn()
  progressListener = undefined
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      workflowBenchRun: benchRun,
      onWorkflowBenchProgress: vi.fn((l) => {
        progressListener = l
        return detach
      })
    }
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const q = <T extends Element>(sel: string): T => container.querySelector<T>(sel)!
const bouton = (): HTMLButtonElement => q('[data-testid="workflow-bench-run"]')

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(WorkflowBenchPanel, {
        profiles: [
          { id: 'vif', name: 'Vif' },
          { id: 'lent', name: 'Lent' }
        ]
      })
    )
  })
}

async function saisir(texte: string): Promise<void> {
  const zone = q<HTMLTextAreaElement>('[data-testid="workflow-bench-objective"]')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      'value'
    )!.set!
    setter.call(zone, texte)
    zone.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function cocher(id: string): Promise<void> {
  await act(async () => q<HTMLInputElement>(`[data-testid="workflow-bench-pick-${id}"]`).click())
}

describe('lancer une confrontation', () => {
  it('refuse de partir sans objectif, et DIT pourquoi', async () => {
    await render()
    await cocher('vif')
    await cocher('lent')
    expect(bouton().disabled).toBe(true)
    expect(q('.workflow-bench-hint').textContent).toContain('objectif')
  })

  it('refuse un seul workflow, et DIT pourquoi', async () => {
    await render()
    await saisir('ranger')
    await cocher('vif')
    expect(bouton().disabled).toBe(true)
    // Un bouton gris muet fait chercher ; la règle tient en une phrase.
    expect(q('.workflow-bench-hint').textContent).toContain('au moins deux')
  })

  it('lance avec l’objectif et les workflows retenus', async () => {
    await render()
    await saisir('ranger la cuisine')
    await cocher('vif')
    await cocher('lent')
    expect(bouton().disabled).toBe(false)
    await act(async () => bouton().click())
    expect(benchRun).toHaveBeenCalledWith('ranger la cuisine', ['vif', 'lent'])
  })

  it('la configuration courante part en null — c’est l’absence de workflow', async () => {
    await render()
    await saisir('ranger')
    await cocher('courante')
    await cocher('vif')
    await act(async () => bouton().click())
    expect(benchRun).toHaveBeenCalledWith('ranger', [null, 'vif'])
  })

  it('affiche le verdict au retour', async () => {
    await render()
    await saisir('ranger')
    await cocher('vif')
    await cocher('lent')
    await act(async () => bouton().click())
    expect(q('[data-testid="workflow-verdict"]')).not.toBeNull()
    expect(container.textContent).toContain('recommandé')
  })

  it('relaie la raison exacte d’un refus du main, pas un « échec » générique', async () => {
    benchRun.mockRejectedValue(new Error('Workflow inconnu : fantome'))
    await render()
    await saisir('ranger')
    await cocher('vif')
    await cocher('lent')
    await act(async () => bouton().click())
    expect(q('[role="alert"]').textContent).toContain('Workflow inconnu : fantome')
    expect(bouton().disabled).toBe(false) // relançable
  })
})

describe('pendant la confrontation', () => {
  it('montre où on en est — plusieurs runs, sinon l’attente ressemble à un plantage', async () => {
    let debloque: (v: unknown) => void = () => undefined
    benchRun.mockReturnValue(new Promise((r) => (debloque = r)))
    await render()
    await saisir('ranger')
    await cocher('vif')
    await cocher('lent')
    await act(async () => bouton().click())
    await act(async () => progressListener?.({ done: 1, total: 2, label: 'Lent' }))
    expect(q('[data-testid="workflow-bench-progress"]').textContent).toContain('1/2 — Lent')
    await act(async () => {
      debloque(rapport)
      await Promise.resolve()
    })
  })

  it('DÉTACHE l’écoute de progression à la fin — sinon chaque lancement en empile une', async () => {
    await render()
    await saisir('ranger')
    await cocher('vif')
    await cocher('lent')
    await act(async () => bouton().click())
    expect(detach).toHaveBeenCalled()
  })
})
