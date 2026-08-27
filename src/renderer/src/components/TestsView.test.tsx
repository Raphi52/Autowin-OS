// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { TestsView } from './TestsView'

function monter(): HTMLDivElement {
  const container = document.createElement('div')
  document.body.append(container)
  return container
}

async function rendre(container: HTMLDivElement): Promise<void> {
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(TestsView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

const projets = [
  {
    id: 'c:/dev/autowin',
    label: 'Autowin OS',
    root: 'C:/dev/autowin',
    runner: 'vitest',
    runnable: true
  },
  { id: 'c:/dev/rig', label: 'RIG', root: 'C:/dev/rig', runner: 'vitest', runnable: true },
  {
    id: 'c:/dev/vide',
    label: 'vide',
    root: 'C:/dev/vide',
    runner: 'none',
    runnable: false,
    reason: 'aucun harnais vitest/jest declare'
  }
]

describe('TestsView — multi-projets', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('liste TOUS les projets du registre, pas seulement Autowin OS', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        testProjects: vi.fn(async () => projets),
        runProjectTests: vi.fn(async () => ({ totals: {}, report: { cases: [] } }))
      }
    })
    const container = monter()
    await rendre(container)
    const noms = [...container.querySelectorAll('[data-testid="test-project"]')].map((n) =>
      n.textContent?.includes('RIG')
    )
    expect(noms.length).toBe(3)
    expect(container.textContent).toContain('RIG')
    expect(container.textContent).toContain('Autowin OS')
    // ENTREE QUI DOIT FAIRE ECHOUER une vue codee en dur sur un seul depot :
    // le projet non executable doit apparaitre AVEC sa raison, pas etre masque.
    expect(container.textContent).toContain('aucun harnais vitest/jest declare')
  })

  it('lance la suite du projet SELECTIONNE et affiche les echecs', async () => {
    const runProjectTests = vi.fn(async (root: string) => ({
      root,
      runner: 'vitest',
      exitCode: 1,
      durationMs: 12,
      totals: { passed: 1, failed: 1, skipped: 0, total: 2 },
      report: {
        cases: [
          { file: 'a.test.ts', name: 'ok', status: 'passed' },
          { file: 'a.test.ts', name: 'ko', status: 'failed', error: 'boom' }
        ]
      }
    }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { testProjects: vi.fn(async () => projets), runProjectTests }
    })
    const container = monter()
    await rendre(container)
    const cible = [...container.querySelectorAll('[data-testid="test-project"]')].find((n) =>
      n.textContent?.includes('RIG')
    ) as HTMLElement
    await act(async () => {
      cible.querySelector('button')?.click()
      await Promise.resolve()
    })
    const lancer = container.querySelector('[data-testid="tests-run"]') as HTMLButtonElement
    await act(async () => {
      lancer.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(runProjectTests.mock.calls[0][0]).toBe('C:/dev/rig')
    expect(container.textContent).toContain('boom')
    expect(container.querySelector('[data-testid="tests-totals"]')?.textContent).toContain('1')
  })

  it('affiche l aveu quand la sortie du harnais est illisible, sans pretendre au vert', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        testProjects: vi.fn(async () => projets),
        runProjectTests: vi.fn(async () => ({
          root: 'C:/dev/autowin',
          runner: 'vitest',
          exitCode: 1,
          durationMs: 3,
          totals: { passed: 0, failed: 0, skipped: 0, total: 0 },
          report: { cases: [], invalid: 'sortie illisible : aucun rapport JSON de test trouve' }
        }))
      }
    })
    const container = monter()
    await rendre(container)
    const lancer = container.querySelector('[data-testid="tests-run"]') as HTMLButtonElement
    await act(async () => {
      lancer.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="tests-invalid"]')?.textContent).toContain(
      'illisible'
    )
  })

  // ROUGE issu de la capture /see : l'ecran affichait EN MEME TEMPS « canal tests:projects
  // indisponible » et l'invite « Aucun projet enregistre » — deux messages contradictoires,
  // dont un qui invite a agir alors que le canal est mort.
  it('sur canal absent, avoue la panne et n invite PAS a ajouter un projet', async () => {
    Object.defineProperty(window, 'api', { configurable: true, value: {} })
    const container = monter()
    await rendre(container)
    expect(container.textContent).toContain('canal tests:projects indisponible')
    expect(container.textContent).not.toContain('Aucun projet enregistr')
  })

  // ENTREE REFUTANTE : canal PRESENT rendant une liste vide. Si la correction supprimait l'invite
  // en toutes circonstances, l'utilisateur n'aurait plus aucun point d'entree — ce test echouerait.
  it('canal present et registre vide : l invite d ajout reste affichee', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { testProjects: vi.fn(async () => []) }
    })
    const container = monter()
    await rendre(container)
    expect(container.textContent).toContain('Aucun projet enregistr')
    expect(container.textContent).not.toContain('indisponible')
  })
})
