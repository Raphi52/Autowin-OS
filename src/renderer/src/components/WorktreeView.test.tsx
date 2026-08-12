import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import { WorktreeView } from './WorktreeView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const snapshot = {
  available: true as const,
  repoPath: 'C:\\Amitel\\Autowin OS',
  repositoryName: 'Autowin OS',
  head: '46285c3',
  branch: 'main',
  changeCount: 2,
  refs: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      kind: 'local' as const,
      hash: '46285c3full',
      isHead: true
    },
    {
      name: 'feat/cockpit',
      fullName: 'refs/heads/feat/cockpit',
      kind: 'local' as const,
      hash: '5d5cc22full',
      isHead: false
    }
  ],
  worktrees: [
    {
      path: 'C:\\Amitel\\Autowin OS',
      head: '46285c3full',
      branch: 'main',
      detached: false,
      locked: false
    },
    {
      path: 'C:\\Amitel\\wt\\cockpit',
      head: '5d5cc22full',
      branch: 'feat/cockpit',
      detached: false,
      locked: false
    }
  ],
  commits: [
    {
      hash: '46285c3full',
      shortHash: '46285c3',
      parents: ['5d5cc22full'],
      refs: ['HEAD -> main'],
      author: 'Raphaël',
      date: '2026-07-23T19:00:00.000Z',
      subject: 'merge: cockpit'
    },
    {
      hash: '5d5cc22full',
      shortHash: '5d5cc22',
      parents: [],
      refs: ['feat/cockpit'],
      author: 'Raphaël',
      date: '2026-07-23T18:00:00.000Z',
      subject: 'feat: cockpit'
    }
  ]
}

const activity: WorktreeAgentActivity[] = [
  {
    agentId: 'builder',
    agentName: 'Builder',
    role: 'build',
    task: 'Construire le cockpit',
    worktreePath: 'C:\\Amitel\\wt\\cockpit',
    state: 'working',
    verdict: 'running',
    publication: 'not-requested',
    files: [{ path: 'src/renderer/WorktreeView.tsx', kind: 'mod' }],
    startedAtMs: Date.now() - 30_000
  },
  {
    agentId: 'judge',
    agentName: 'Judge',
    role: 'judge',
    task: 'Trancher le conflit',
    state: 'conflict',
    verdict: 'red',
    publication: 'blocked',
    files: [{ path: 'src/shared/state.ts', kind: 'mod' }],
    conflictFile: 'src/shared/state.ts',
    startedAtMs: Date.now() - 120_000,
    endedAtMs: Date.now() - 60_000
  }
]

let container: HTMLDivElement | undefined
let root: Root | undefined
let previousApi: PropertyDescriptor | undefined

function installApi(
  overrides: Record<string, unknown> = {}
): Record<string, ReturnType<typeof vi.fn>> {
  const api = {
    getGitGraph: vi.fn(async () => snapshot),
    getWorktreeActivity: vi.fn(async () => activity),
    getWorktreeStatus: vi.fn(async () => ({ available: true, workspacePath: snapshot.repoPath })),
    onWorktreeActivity: vi.fn(() => () => {}),
    getGitDiff: vi.fn(async () => ({ available: true, diff: '@@ -1 +1 @@\n-old\n+new' })),
    listRuns: vi.fn(async () => [
      {
        subject: 'Construire le cockpit',
        session: 'session-builder',
        path: 'C:\\runs\\cockpit\\RUN.md',
        mtime: Date.now(),
        summary: {
          status: 'open',
          regime: 'standard',
          dodTotal: 3,
          dodChecked: 1,
          journalEvents: 2,
          defauts: 0
        }
      }
    ]),
    readNodeFile: vi.fn(async (path: string) => ({ path, content: '# RUN\nstatus: open' })),
    ...overrides
  }
  previousApi = Object.getOwnPropertyDescriptor(window, 'api')
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  return api as Record<string, ReturnType<typeof vi.fn>>
}

async function renderView(): Promise<void> {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(WorktreeView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
}

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
  root = undefined
  container = undefined
  if (previousApi) Object.defineProperty(window, 'api', previousApi)
  else Reflect.deleteProperty(window, 'api')
  previousApi = undefined
  localStorage.clear()
})

describe('WorktreeView — l’état du DÉPÔT, pas d’une conversation', () => {
  it('montre la topologie et la frise SANS clic préalable', async () => {
    installApi()
    await renderView()

    expect(container?.textContent).toContain('Autowin OS')
    expect(container?.textContent).toContain('main')
    expect(container?.textContent).toContain('Changements locaux')
    // LE point de la vue : la topologie était cachée derrière un bouton « Ouvrir la topologie Git ».
    expect(container?.querySelector('[data-testid="worktree-topology-main"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="git-topology"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="worktree-frise"]')).not.toBeNull()
    expect(container?.textContent).not.toMatch(/\d{1,3}\s?%/)
  })

  it('ne montre RIEN qui soit propre à une conversation', async () => {
    installApi()
    await renderView()

    // Ces sections listaient les runs, leurs tâches et leurs fichiers : c'est le domaine d'Observatory
    // et de Chat. Les voir revenir ici est exactement la régression que ce test interdit.
    expect(container?.querySelector('[data-testid="worktree-priorities"]')).toBeNull()
    expect(container?.querySelector('[data-testid="worktree-current-work"]')).toBeNull()
    expect(container?.querySelector('[data-testid="worktree-recent-activity"]')).toBeNull()
    expect(container?.textContent).not.toContain('À faire maintenant')
    expect(container?.textContent).not.toContain('Travaux en cours')
    expect(container?.textContent).not.toContain('Activité récente')
    expect(container?.textContent).not.toContain('Ouvrir la topologie Git')
  })

  it('la frise et le graphe désignent le MÊME nombre de commits', async () => {
    installApi()
    await renderView()

    // Deux dispositions calculées séparément dériveraient : un trait de la frise ne pointerait plus le
    // commit qu'il désigne. Les deux consomment `layoutGitGraph` sur la même entrée.
    const traits = container?.querySelectorAll('[data-testid="worktree-frise"] line').length ?? 0
    const noeuds = container?.querySelectorAll('[data-testid="git-topology"] circle').length ?? 0
    expect(traits).toBeGreaterThan(0)
    expect(traits).toBe(noeuds)
  })

  it.each([
    [
      'sain',
      {
        activity: [],
        status: { available: true, workspacePath: snapshot.repoPath },
        graph: snapshot
      }
    ],
    [
      'inconnu',
      {
        activity: [{ ...activity[0], verdict: 'unknown' }],
        status: { available: true, workspacePath: snapshot.repoPath },
        graph: snapshot
      }
    ],
    [
      'indisponible',
      {
        activity: [],
        status: { available: false, workspacePath: 'D:\\notes', reason: 'not-git' },
        graph: { available: false, repoPath: 'D:\\notes', error: 'not a git repository' }
      }
    ],
    [
      'obsolète',
      {
        activity: [{ ...activity[0], startedAtMs: Date.now() - 86_400_000 }],
        status: { available: true, workspacePath: snapshot.repoPath },
        graph: snapshot
      }
    ]
  ])('distingue explicitement la santé %s', async (label, fixture) => {
    installApi({
      getGitGraph: vi.fn(async () => fixture.graph),
      getWorktreeActivity: vi.fn(async () => fixture.activity),
      getWorktreeStatus: vi.fn(async () => fixture.status)
    })
    await renderView()
    expect(container?.textContent?.toLocaleLowerCase('fr')).toContain(label)
  })

  it('affiche le chargement puis un projet vide sans masquer la structure du cockpit', async () => {
    let resolveGraph: ((value: typeof snapshot) => void) | undefined
    const graph = new Promise<typeof snapshot>((resolve) => {
      resolveGraph = resolve
    })
    installApi({
      getGitGraph: vi.fn(() => graph),
      getWorktreeActivity: vi.fn(async () => []),
      getWorktreeStatus: vi.fn(async () => ({ available: true, workspacePath: snapshot.repoPath }))
    })

    const pendingRender = renderView()
    await act(async () => {
      await Promise.resolve()
    })
    expect(container?.querySelector('[role="status"]')?.textContent).toMatch(/chargement|lecture/i)
    await act(async () => {
      resolveGraph?.({ ...snapshot, changeCount: 0, refs: [], worktrees: [], commits: [] })
      await pendingRender
    })
    // Un dépôt sans commit garde sa structure : en-tête, bandeau de santé, cadre de topologie.
    expect(container?.querySelector('[data-testid="worktree-topology-main"]')).not.toBeNull()
    expect(container?.textContent).toContain('Changements locaux')
  })

  it('conserve les données disponibles quand Git échoue ou que l’activité est partielle', async () => {
    installApi({
      getGitGraph: vi.fn(async () => ({
        available: false,
        repoPath: snapshot.repoPath,
        error: 'fatal: index corrupt'
      })),
      getWorktreeActivity: vi.fn(async () => [{ ...activity[0], files: [], verdict: undefined }])
    })
    await renderView()

    expect(container?.textContent).toContain('indisponible')
    expect(container?.textContent).toContain('fatal: index corrupt')
    // Le verdict « inconnu » d'un run était vérifié ici parce que cet onglet listait les runs. Il ne les
    // liste plus (c'est Observatory qui les porte), donc on vérifie ce que CET onglet doit garantir :
    // quand Git est illisible, il le NOMME au lieu d'afficher un dépôt sain.
    expect(container?.textContent?.toLocaleLowerCase('fr')).not.toContain('sain')
    expect(container?.querySelector('[data-testid="worktree-topology-main"]')).not.toBeNull()
  })

  it('place le résumé chef de projet AVANT la frise et la topologie', async () => {
    installApi()
    await renderView()

    // L'ordre EST la fonctionnalité : « en un coup d'œil » veut dire en haut, avant le tracé détaillé.
    const html = container?.innerHTML ?? ''
    const resume = html.indexOf('worktree-chef-de-projet')
    const topologie = html.indexOf('worktree-topology-main')
    expect(resume).toBeGreaterThan(-1)
    expect(resume).toBeLessThan(topologie)
    // La frise est IMBRIQUÉE dans la section topologie — son identifiant apparaît donc après celui de
    // la section, et comparer les deux positions à plat donnait un faux échec.
    const sectionTopologie = container?.querySelector('[data-testid="worktree-topology-main"]')
    expect(sectionTopologie?.querySelector('[data-testid="worktree-frise"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="worktree-flux"]')).not.toBeNull()
    // Chaque pastille écrit son verdict : la couleur ne porte pas l'information seule.
    expect(container?.querySelector('[data-testid="worktree-chantiers"]')?.textContent).toMatch(
      /à toi|prêt à fusionner|en cours|à vérifier|interrompu|terminé/
    )
  })

  it('dit que l’avancement est indisponible au lieu d’afficher des zéros', async () => {
    installApi({
      getWorktreeActivity: vi.fn(async () => {
        throw new Error('activité indisponible')
      })
    })
    await renderView()

    // Un bandeau à zéro se lirait comme « projet au calme », ce qui est un mensonge quand la donnée
    // n'a pas pu être lue.
    const bloc = container?.querySelector('[data-testid="worktree-chef-de-projet"]')
    expect(bloc?.textContent).toContain('indisponible')
    expect(container?.querySelector('[data-testid="worktree-flux"]')).toBeNull()
  })

  it('le conteneur de la topologie a une hauteur BORNÉE, sinon la frise ne montre rien', () => {
    // Défaut rencontré et mesuré : avec `flex: 1` seul, ce conteneur grandissait avec ses 271 commits,
    // son `scrollTop` restait à 0 et le cadre « portion lue » couvrait 1000/1000 de la frise — elle
    // prétendait donc que tout l'historique était visible. C'est `.cockpit-scroll` qui défilait.
    const css = readFileSync(join(__dirname, 'WorktreeView.css'), 'utf8')
    const bloc = css.slice(css.indexOf('.wt-topologie-defilement'))
    const regle = bloc.slice(0, bloc.indexOf('}'))
    expect(regle).toMatch(/overflow:\s*auto/)
    expect(regle).toMatch(/height:\s*min\(/)
  })

  it('ne lit ni diff ni RUN au chargement : la topologie ne coûte pas ces appels', async () => {
    const api = installApi()
    await renderView()

    // La topologie est désormais montrée d'emblée ; cela ne doit PAS entraîner la lecture des diffs ni
    // des RUN, qui sont des lectures disque par fichier.
    expect(container?.querySelector('[data-testid="git-topology"]')).not.toBeNull()
    expect(api.getGitDiff).not.toHaveBeenCalled()
    expect(api.readNodeFile).not.toHaveBeenCalled()
  })
})
