// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowBenchPanel } from './WorkflowBenchPanel'

let container: HTMLDivElement
let root: Root
let benchRun: ReturnType<typeof vi.fn>
let detach: ReturnType<typeof vi.fn>
let cancel: ReturnType<typeof vi.fn>
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
  cancel = vi.fn().mockResolvedValue(true)
  progressListener = undefined
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      workflowBenchRun: benchRun,
      workflowBenchCancel: cancel,
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
          { id: 'lent', name: 'Lent' },
          { id: 'robuste', name: 'Robuste' }
        ]
      })
    )
  })
}

async function saisir(texte: string): Promise<void> {
  const zone = q<HTMLTextAreaElement>('[data-testid="workflow-bench-objective"]')
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    setter.call(zone, texte)
    zone.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

async function cocher(id: string): Promise<void> {
  await act(async () => q<HTMLInputElement>(`[data-testid="workflow-bench-pick-${id}"]`).click())
}

describe('lancer une confrontation', () => {
  it('le tournoi est OFF par défaut et reste une activation explicite', async () => {
    await render()
    const toggle = q<HTMLInputElement>('[data-testid="workflow-bench-tournament"]')
    expect(toggle.checked).toBe(false)
    expect(container.textContent).toContain('facultatif')
  })

  it('le tournoi exige trois workflows et envoie le mode sans fusion automatique', async () => {
    await render()
    await saisir('ranger')
    await act(async () => q<HTMLInputElement>('[data-testid="workflow-bench-tournament"]').click())
    await cocher('vif')
    await cocher('lent')
    expect(bouton().disabled).toBe(true)
    expect(q('.workflow-bench-hint').textContent).toContain('exactement trois')
    await cocher('robuste')
    await act(async () => bouton().click())
    expect(benchRun).toHaveBeenCalledWith('ranger', ['vif', 'lent', 'robuste'], {
      mode: 'tournament'
    })
    expect(q<HTMLInputElement>('[data-testid="workflow-bench-tournament"]').checked).toBe(false)
  })

  it('le contrefactuel confronte exactement deux profils depuis un checkpoint commun', async () => {
    await render()
    await saisir('ranger')
    const toggle = q<HTMLInputElement>('[data-testid="workflow-bench-counterfactual"]')
    await act(async () => toggle.click())
    await cocher('vif')
    await cocher('lent')
    expect(bouton().disabled).toBe(false)
    await act(async () => bouton().click())
    expect(benchRun).toHaveBeenCalledWith('ranger', ['vif', 'lent'], {
      mode: 'counterfactual'
    })
    expect(toggle.checked).toBe(false)
  })

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

  it('rend les écarts de CONTENU, fichiers propres, coût, durée et risques du contrefactuel', async () => {
    benchRun.mockResolvedValue({
      ...rapport,
      mode: 'counterfactual',
      counterfactual: {
        diff: {
          sharedFiles: ['src/commun.ts'],
          differingSharedFiles: ['src/commun.ts'],
          onlyByProfile: { vif: ['src/vif.ts'], lent: ['src/lent.ts'] },
          sameResult: false
        },
        arms: [
          {
            profileId: 'vif',
            profileName: 'Vif',
            costUsd: 1.25,
            durationMs: 2_500,
            changedFiles: ['src/commun.ts', 'src/vif.ts'],
            verdict: 'eligible',
            risks: []
          },
          {
            profileId: 'lent',
            profileName: 'Lent',
            costUsd: null,
            durationMs: null,
            changedFiles: ['src/commun.ts', 'src/lent.ts'],
            verdict: 'rejected',
            risks: [{ code: 'run-red', detail: 'Le run ne clôture pas vert.' }]
          }
        ],
        verdict: { winnerProfileId: 'vif', rationale: 'Vif gagne.' }
      }
    })
    await render()
    await saisir('ranger')
    await cocher('vif')
    await cocher('lent')
    await act(async () => bouton().click())

    expect(q('[data-testid="workflow-bench-content-diff"]').textContent).toContain('src/commun.ts')
    expect(container.textContent).toContain('src/vif.ts')
    expect(container.textContent).toContain('1.2500 $')
    expect(container.textContent).toContain('2.5 s')
    expect(container.textContent).toContain('coût inconnu')
    expect(container.textContent).toContain('Le run ne clôture pas vert.')
  })

  it('affiche un tournoi dans l’ordre de son classement mesuré', async () => {
    benchRun.mockResolvedValue({
      ...rapport,
      mode: 'tournament',
      rows: rapport.rows,
      ranking: [...rapport.rows].reverse(),
      winnerProfileId: 'lent',
      tournamentRationale: 'classement mesuré'
    })
    await render()
    await saisir('ranger')
    await cocher('vif')
    await cocher('lent')
    await act(async () => bouton().click())

    const labels = [...container.querySelectorAll('tbody th')].map((cell) => cell.textContent)
    expect(labels[0]).toContain('Lent')
    expect(labels[1]).toContain('Vif')
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

  it('consomme aussi l’opt-in tournoi quand l’appel IPC échoue', async () => {
    benchRun.mockRejectedValue(new Error('quota épuisé'))
    await render()
    await saisir('ranger')
    const toggle = q<HTMLInputElement>('[data-testid="workflow-bench-tournament"]')
    await act(async () => toggle.click())
    await cocher('vif')
    await cocher('lent')
    await cocher('robuste')
    await act(async () => bouton().click())

    expect(toggle.checked).toBe(false)
    expect(q('[role="alert"]').textContent).toContain('quota épuisé')
  })
})

describe('pendant la confrontation', () => {
  it('permet d’annuler le run en cours et rend l’action visible', async () => {
    benchRun.mockReturnValue(new Promise(() => undefined))
    await render()
    await saisir('ranger')
    await cocher('vif')
    await cocher('lent')
    await act(async () => bouton().click())

    const cancelButton = q<HTMLButtonElement>('[data-testid="workflow-bench-cancel"]')
    await act(async () => cancelButton.click())
    expect(cancel).toHaveBeenCalledTimes(1)
    expect(q('[data-testid="workflow-bench-progress"]').textContent).toContain('Annulation')
  })

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
