// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowProfilesView } from './WorkflowProfilesView'

/**
 * MONTRER LA MESURE DEJA PAYEE.
 *
 * arena-duels.jsonl porte 82 duels avec duree, cout et verdict par workflow. La vue promettait de
 * « comparer » en REJOUANT l'objectif (2,1 a 16 min et 0,55 a 5,51 $ par bras), alors que la
 * mesure existe sur disque. Elle l'affiche desormais — et DIT quand il n'y en a aucune, plutot que
 * d'afficher un zero qui ferait croire a une mesure.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

const rapide = { id: 'rapide', name: 'Rapide', phases: ['build'] }

function api(duels: Record<string, unknown>): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      workflowProfiles: vi.fn().mockResolvedValue({ profiles: [rapide], activeId: null }),
      workflowProfileSelect: vi.fn(),
      workflowProfileRemove: vi.fn(),
      workflowProfileSave: vi.fn(),
      arenaDuelsParWorkflow: vi.fn().mockResolvedValue(duels)
    }
  })
}

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(WorkflowProfilesView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('vue Workflows — mesures d’arène déjà journalisées', () => {
  it('affiche durée médiane, coût médian et nombre de duels du workflow', async () => {
    api({
      Rapide: { duels: 4, dureeMedianeMs: 126000, coutMedianUsd: 1.25, verdicts: { gagnant: 3 } }
    })
    await render()

    const mesures = container.querySelector('[data-testid="workflow-mesures-rapide"]')
    expect(mesures).not.toBeNull()
    const texte = mesures?.textContent ?? ''
    expect(texte).toContain('4')
    expect(texte).toMatch(/2\s?min/)
    expect(texte).toContain('1,25')
  })

  it('dit « aucune mesure » au lieu d’afficher un zéro quand aucun duel ne porte ce workflow', async () => {
    api({ 'Autre workflow': { duels: 2, dureeMedianeMs: 1000, coutMedianUsd: 1, verdicts: {} } })
    await render()

    const mesures = container.querySelector('[data-testid="workflow-mesures-rapide"]')
    expect(mesures?.textContent ?? '').toMatch(/aucune mesure/i)
    expect(mesures?.textContent ?? '').not.toContain('0,00')
  })
})
