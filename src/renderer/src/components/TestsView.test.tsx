// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
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

  // ROUGE issu de la capture /look : l'ecran affichait EN MEME TEMPS « canal tests:projects
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

/**
 * Les 5 manques lus dans TestsView.tsx (run aveugle, liste plate, pas de relance ciblee, pas de
 * memoire du dernier run, erreur ni copiable ni ouvrable). Chaque test nomme l'ENTREE qui le ferait
 * echouer si la correction etait fausse.
 */
const resultatDeux = {
  root: 'C:/dev/autowin',
  runner: 'vitest',
  exitCode: 1,
  durationMs: 12,
  totals: { passed: 1, failed: 1, skipped: 0, total: 2 },
  report: {
    cases: [
      { file: 'a.test.ts', name: 'ok', status: 'passed', durationMs: 2 },
      {
        file: 'b.test.ts',
        name: 'ko',
        status: 'failed',
        error: 'AssertionError: boom\n  at b.test.ts:42:3'
      }
    ]
  }
}

async function lancerSuite(container: HTMLDivElement): Promise<void> {
  const lancer = container.querySelector('[data-testid="tests-run"]') as HTMLButtonElement
  await act(async () => {
    lancer.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('TestsView — 5 manques', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  beforeEach(() => {
    window.localStorage.clear()
  })

  // 1 — run bloquant sans feedback
  it('affiche une progression VIVANTE pendant l execution (pas seulement « Execution… »)', async () => {
    let resoudre: (v: unknown) => void = () => {}
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        testProjects: vi.fn(async () => projets),
        runProjectTests: vi.fn(() => new Promise((r) => (resoudre = r)))
      }
    })
    const container = monter()
    await rendre(container)
    const lancer = container.querySelector('[data-testid="tests-run"]') as HTMLButtonElement
    await act(async () => {
      lancer.click()
      await Promise.resolve()
    })
    const progres = container.querySelector('[data-testid="tests-progress"]')
    expect(progres).not.toBeNull()
    // ENTREE REFUTANTE : un bandeau CODE EN DUR resterait affiche apres la fin du run.
    expect(progres?.textContent).toMatch(/Autowin OS/)
    await act(async () => {
      resoudre(resultatDeux)
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="tests-progress"]')).toBeNull()
  })

  // 2 — liste plate : groupement par fichier + repli
  it('groupe les cas par FICHIER et permet de replier un groupe', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        testProjects: vi.fn(async () => projets),
        runProjectTests: vi.fn(async () => resultatDeux)
      }
    })
    const container = monter()
    await rendre(container)
    await lancerSuite(container)
    const groupes = [...container.querySelectorAll('[data-testid="tests-file-group"]')]
    expect(groupes.length).toBe(2)
    expect(container.textContent).toContain('ko')
    const repli = groupes
      .find((g) => g.textContent?.includes('b.test.ts'))
      ?.querySelector('[data-testid="tests-file-toggle"]') as HTMLButtonElement
    await act(async () => {
      repli.click()
      await Promise.resolve()
    })
    // ENTREE QUI DOIT FAIRE ECHOUER un faux repli (masquage CSS ou repli global) :
    // le cas de b.test.ts disparait, celui de a.test.ts reste.
    expect(container.textContent).not.toContain('ko')
    expect(container.textContent).toContain('ok')
  })

  // 3 — relance ciblee
  it('rejoue UN SEUL fichier via le bouton du groupe, sans toucher au filtre global', async () => {
    const runProjectTests = vi.fn(async () => resultatDeux)
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: { testProjects: vi.fn(async () => projets), runProjectTests }
    })
    const container = monter()
    await rendre(container)
    await lancerSuite(container)
    const bouton = [...container.querySelectorAll('[data-testid="tests-file-group"]')]
      .find((g) => g.textContent?.includes('b.test.ts'))
      ?.querySelector('[data-testid="tests-file-rerun"]') as HTMLButtonElement
    await act(async () => {
      bouton.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    // ENTREE REFUTANTE : une relance qui reprendrait le filtre global enverrait undefined ici.
    expect(runProjectTests.mock.calls[1]).toEqual(['C:/dev/autowin', 'b.test.ts'])
    expect(
      (container.querySelector('[data-testid="tests-filter"]') as HTMLInputElement).value
    ).toBe('')
  })

  // 4 — memoire du dernier run
  it('restaure le dernier run au remontage, marque comme MEMORISE', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        testProjects: vi.fn(async () => projets),
        runProjectTests: vi.fn(async () => resultatDeux)
      }
    })
    const premier = monter()
    await rendre(premier)
    await lancerSuite(premier)
    expect(premier.textContent).toContain('boom')

    const second = monter()
    await rendre(second)
    expect(second.querySelector('[data-testid="tests-totals"]')?.textContent).toContain('1')
    expect(second.querySelector('[data-testid="tests-memo"]')).not.toBeNull()
    // ENTREE QUI DOIT FAIRE ECHOUER une memoire qui se ferait passer pour un run frais :
    // un run memorise est etiquete, jamais presente comme venant de s executer.
    expect(second.querySelector('[data-testid="tests-memo"]')?.textContent).toMatch(
      /mémoris|dernier run/i
    )
  })

  // 5 — copier / ouvrir l erreur
  it('copie l erreur dans le presse-papiers et ouvre le fichier fautif', async () => {
    const revealFile = vi.fn(async () => ({ ok: true }))
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        testProjects: vi.fn(async () => projets),
        runProjectTests: vi.fn(async () => resultatDeux),
        revealFile
      }
    })
    const writeText = vi.fn(async (_texte: string) => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    const container = monter()
    await rendre(container)
    await lancerSuite(container)
    const copier = container.querySelector('[data-testid="tests-case-copy"]') as HTMLButtonElement
    const ouvrir = container.querySelector('[data-testid="tests-case-open"]') as HTMLButtonElement
    await act(async () => {
      copier.click()
      ouvrir.click()
      await Promise.resolve()
    })
    expect(writeText.mock.calls[0][0]).toContain('AssertionError: boom')
    // ENTREE REFUTANTE : un bouton pose sur CHAQUE cas (meme passe) casserait ce compte,
    // et une ouverture sans ligne perdrait le 42 lu dans la trace.
    expect(container.querySelectorAll('[data-testid="tests-case-copy"]').length).toBe(1)
    expect(revealFile.mock.calls[0]).toEqual(['C:/dev/autowin/b.test.ts', 42])
  })
})
