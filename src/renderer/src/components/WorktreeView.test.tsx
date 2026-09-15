import { readFileSync } from 'node:fs'
import { join } from 'node:path'
// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import { WorktreeView } from './WorktreeView'
import { couleurDeBranche } from './git-graph-couleurs'

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
    runGitAction: vi.fn(async () => ({
      ok: true as const,
      commande: 'git checkout main && git merge --no-ff feat/cockpit',
      sortie: 'Merge made by the ort strategy.'
    })),
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
  it('montre la topologie sans timeline SANS clic préalable', async () => {
    installApi()
    await renderView()

    expect(container?.textContent).toContain('Autowin OS')
    expect(container?.textContent).toContain('main')
    expect(container?.textContent).toContain('Changements locaux')
    // LE point de la vue : la topologie était cachée derrière un bouton « Ouvrir la topologie Git ».
    expect(container?.querySelector('[data-testid="worktree-topology-main"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="git-topology"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="worktree-frise"]')).toBeNull()
    expect(container?.textContent).not.toMatch(/\b\d{1,3}\s?%/)
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

  it('ANNONCE l’histoire élidée au lieu de laisser un trou muet', async () => {
    /*
      La ligne principale n'est qu'une somme de segments parent→enfant : là où le parent n'est pas
      chargé, aucune arête n'était émise et le trou se lisait comme une donnée cassée. Or l'omission
      est délibérée — le graphe ajoute les commits porteurs d'une ref à n'importe quelle profondeur,
      sans leurs ancêtres. Mesuré le 2026-08-14 sur ce dépôt : 23 sauts, dont un de 181 commits.

      Ce test tient le CÂBLAGE de bout en bout : sans le passage des élisions au layout, la vue rend
      à nouveau un trou muet. C'est le seul endroit où cette chaîne est vérifiée entière.
    */
    installApi({
      getGitGraph: vi.fn(async () => ({
        ...snapshot,
        mainLineHashes: ['46285c3full', '5d5cc22full'],
        mainLineElisions: [{ from: '46285c3full', to: '5d5cc22full', omis: 27 }]
      }))
    })
    await renderView()

    const libelle = container?.querySelector('[data-testid="git-topology-elision"]')
    expect(libelle?.textContent).toBe('⋯ 27 commits non chargés')
    expect(container?.querySelector('.wt-topologie-lien.is-elide')).not.toBeNull()
  })

  it('ne montre AUCUN libellé d’élision quand l’histoire est contiguë', async () => {
    // Le haut du graphe est réellement continu (0 saut mesuré dans la fenêtre récente) : y afficher
    // un « ⋯ » serait une fausse alerte, pire que le trou d'origine.
    installApi()
    await renderView()

    expect(container?.querySelector('[data-testid="git-topology-elision"]')).toBeNull()
  })

  it('rend le graphe en TABLEAU façon SourceTree : gouttière, description, auteur, date', async () => {
    /*
      LA DEMANDE (2026-09-15) : « j'aime bien SourceTree, le côté graphique, ça permet de comprendre
      tout de suite ». L'écran d'avant dessinait le sujet du commit DANS le SVG, à droite de trois
      colonnes épinglées : `author` et `date` existaient dans le modèle et n'étaient affichés nulle
      part, et il fallait défiler horizontalement pour lire une ligne.
    */
    installApi()
    await renderView()

    const tableau = container?.querySelector('[data-testid="git-topology"]')
    const entete = tableau?.querySelector('[data-testid="git-topology-entete"]')?.textContent ?? ''
    expect(entete).toContain('Graphique')
    expect(entete).toContain('Description')
    expect(entete).toContain('Auteur')
    expect(entete).toContain('Date')

    const lignes = [...(tableau?.querySelectorAll('[data-testid="git-commit-row"]') ?? [])]
    expect(lignes).toHaveLength(snapshot.commits.length)
    expect(lignes[0].textContent).toContain('merge: cockpit')
    expect(lignes[0].querySelector('[data-testid="git-commit-auteur"]')?.textContent).toBe(
      'Raphaël'
    )
    expect(lignes[0].querySelector('[data-testid="git-commit-date"]')?.textContent).toMatch(/\d/)
    // Chaque ligne est ANCRÉE sur son commit : c'est ce que le glisser-déposer saisira.
    expect(lignes[0].getAttribute('data-commit')).toBe('46285c3full')
  })

  it('pose les étiquettes de branche sur la ligne, colorées d’après leur NOM', async () => {
    installApi()
    await renderView()

    const badges = [
      ...(container?.querySelectorAll('[data-testid="git-ref-badge"]') ?? [])
    ] as HTMLElement[]
    expect(badges.map((badge) => badge.textContent)).toEqual(['main', 'feat/cockpit'])
    // La couleur vient du nom, donc elle ne change pas d'un rafraîchissement à l'autre.
    expect(badges[1].getAttribute('style')).toContain(couleurDeBranche('feat/cockpit'))
  })

  it('colore les points par branche au lieu des trois couleurs de catégorie', async () => {
    installApi()
    await renderView()

    const points = [
      ...(container?.querySelectorAll('[data-testid="git-topology"] circle') ?? [])
    ] as SVGCircleElement[]
    expect(points[0].getAttribute('stroke')).toBe(couleurDeBranche('main'))
    expect(points[1].getAttribute('stroke')).toBe(couleurDeBranche('feat/cockpit'))
    // La gouttière est ÉTROITE : plus d'épinglage à 280 px + 480 px de marge morte.
    points.forEach((point) => expect(Number(point.getAttribute('cx'))).toBeLessThan(120))
  })

  it('le graphe rend un noeud par commit affiché', async () => {
    installApi()
    await renderView()

    const noeuds = container?.querySelectorAll('[data-testid="git-topology"] circle').length ?? 0
    expect(noeuds).toBe(snapshot.commits.length)
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

  it('place le résumé chef de projet AVANT la topologie', async () => {
    installApi()
    await renderView()

    // L'ordre EST la fonctionnalité : « en un coup d'œil » veut dire en haut, avant le tracé détaillé.
    const html = container?.innerHTML ?? ''
    const resume = html.indexOf('worktree-chef-de-projet')
    const topologie = html.indexOf('worktree-topology-main')
    expect(resume).toBeGreaterThan(-1)
    expect(resume).toBeLessThan(topologie)
    const sectionTopologie = container?.querySelector('[data-testid="worktree-topology-main"]')
    expect(sectionTopologie?.querySelector('[data-testid="worktree-frise"]')).toBeNull()
    expect(container?.querySelector('[data-testid="worktree-flux"]')).not.toBeNull()
    // Chaque pastille écrit son verdict : la couleur ne porte pas l'information seule.
    expect(container?.querySelector('[data-testid="worktree-chantiers"]')?.textContent).toMatch(
      /à toi|prêt à fusionner|en cours|à vérifier|interrompu|terminé/
    )
  })

  it('distingue visuellement la ligne de la branche principale sans marquer les autres', async () => {
    installApi({
      getWorktreeActivity: vi.fn(async () => [
        { ...activity[0], agentId: 'main-run', baseBranch: 'main' },
        { ...activity[1], agentId: 'feature-run', baseBranch: 'feat/cockpit' }
      ])
    })
    await renderView()

    const lignes = Array.from(
      container?.querySelectorAll('[data-testid="worktree-chantiers"] .wt-cdp-ligne') ?? []
    )
    const ligneMain = lignes.find(
      (ligne) => ligne.querySelector('.wt-cdp-branche')?.textContent === 'main'
    )
    const ligneFeature = lignes.find(
      (ligne) => ligne.querySelector('.wt-cdp-branche')?.textContent === 'feat/cockpit'
    )

    expect(ligneMain?.classList.contains('is-main')).toBe(true)
    expect(ligneFeature?.classList.contains('is-main')).toBe(false)
  })

  it('dit que la lecture est EN COURS au lieu d’afficher des zéros', async () => {
    // MESURÉ : la récupération hors fil principal met ~16 s à répondre. Pendant ce temps la lecture
    // initiale rend un tableau vide, et le bandeau annonçait « 0 chantier t'attend » alors que 215 runs
    // allaient apparaître. Un zéro se lit « projet au calme ».
    installApi({ getWorktreeActivity: vi.fn(async () => []) })
    await renderView()

    expect(container?.querySelector('[data-testid="worktree-cdp-attente"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="worktree-flux"]')).toBeNull()
    // La topologie, elle, ne dépend pas de l'activité : elle reste affichée.
    expect(container?.querySelector('[data-testid="worktree-topology-main"]')).not.toBeNull()
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

  it('le conteneur de la topologie a une hauteur BORNÉE pour défiler sans étirer la page', () => {
    const css = readFileSync(join(__dirname, 'WorktreeView.css'), 'utf8')
    const bloc = css.slice(css.indexOf('.wt-topologie-defilement'))
    const regle = bloc.slice(0, bloc.indexOf('}'))
    expect(regle).toMatch(/overflow:\s*auto/)
    expect(regle).toMatch(/height:\s*min\(/)
  })

  it('porte LA barre du haut partagée, pas un en-tête maison', async () => {
    installApi()
    await renderView()

    // L'onglet Worktrees monte CETTE vue (`App.tsx` → `WorktreeView`). La barre avait d'abord été
    // alignée sur `WorktreeMapView`, que l'app ne montait pas : rien n'avait change a l'ecran. Cette
    // carte est depuis supprimee ; ce test garde l'ancrage sur le composant REELLEMENT affiche.
    const barre = container?.querySelector('.view-topbar')
    expect(barre).toBeTruthy()
    expect(barre?.querySelector('.module-header h1')?.textContent).toBe('Autowin OS')
    // Les deux actions vivent dans le bloc d'actions de la barre, comme « + Nouvelle tâche » ailleurs.
    const actions = [...(barre?.querySelectorAll('.view-topbar-actions button') ?? [])].map((b) =>
      b.textContent?.trim()
    )
    expect(actions).toEqual(['Choisir', 'Actualiser'])
    // Discriminant : l'ancien en-tête ne doit plus être rendu, sinon les deux coexisteraient.
    expect(container?.querySelector('.cockpit-header')).toBeNull()
    // Aucune section ici : une barre d'onglets VIDE serait pire que pas de barre.
    expect(container?.querySelector('.domain-tabs')).toBeNull()
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

describe('WorktreeView — la résolution de conflit se tranche ICI', () => {
  const DIFF = {
    available: true as const,
    agentId: 'judge',
    paths: ['src/shared/state.ts'],
    diff: '@@ -1 +1 @@\n-version principale\n+version du bureau'
  }

  async function ouvrirComparaison(): Promise<void> {
    await act(async () => {
      ;(
        container?.querySelector('[data-testid="wt-resolve-conflict"]') as HTMLButtonElement
      ).click()
      await Promise.resolve()
      await Promise.resolve()
    })
  }

  it('la résolution de conflit est ATTEIGNABLE depuis cette vue', async () => {
    installApi()
    await renderView()

    // Le point du déplacement : ces boutons n'existaient que dans le panneau de droite du chat.
    expect(container?.querySelector('[data-testid="worktree-conflicts"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="wt-resolve-conflict"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="wt-keep-agent"]')).not.toBeNull()
    expect(container?.querySelector('[data-testid="wt-keep-mine"]')).not.toBeNull()
    // Seuls les bureaux EN CONFLIT : la section ne réinstalle pas le Hub entier.
    expect(
      container?.querySelectorAll(
        '[data-testid="worktree-conflicts"] [data-testid="wt-conflit-ligne"]'
      )
    ).toHaveLength(1)
    // Demande du 2026-09-15 : « juste des boutons ». La fiche de bureau complète — commande, chemin
    // de la copie, base vérifiée, durée, liste des fichiers — ne doit plus être rendue ICI.
    expect(
      container?.querySelector('[data-testid="worktree-conflicts"] [data-testid="wt-agent-office"]')
    ).toBeNull()
    expect(container?.querySelector('[data-testid="wt-main-office"]')).toBeNull()
  })

  it('aucune section conflit quand aucun bureau n’est en conflit', async () => {
    installApi({ getWorktreeActivity: vi.fn(async () => [activity[0]]) })
    await renderView()

    expect(container?.querySelector('[data-testid="worktree-conflicts"]')).toBeNull()
  })

  it('ouvre la comparaison lecture seule puis la referme', async () => {
    const api = installApi({ getWorktreeConflictDiff: vi.fn(async () => DIFF) })
    await renderView()
    await ouvrirComparaison()

    expect(api.getWorktreeConflictDiff).toHaveBeenCalledWith('judge')
    expect(container?.querySelector('[data-testid="wt-conflict-diff"]')).not.toBeNull()
    expect(container?.textContent).toContain('version du bureau')

    await act(async () => {
      ;(container?.querySelector('[data-testid="wt-conflict-close"]') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(container?.querySelector('[data-testid="wt-conflict-diff"]')).toBeNull()
  })

  it('nomme l’échec de comparaison au lieu de rester en préparation', async () => {
    installApi({
      getWorktreeConflictDiff: vi.fn(() => Promise.reject(new Error('bureau illisible')))
    })
    await renderView()
    await ouvrirComparaison()

    expect(
      container?.querySelector('[data-testid="wt-conflict-diff-error"]')?.textContent
    ).toContain('a échoué')
    expect(container?.textContent).not.toContain('Préparation des deux versions')
  })

  it('envoie le choix au processus principal puis referme la comparaison', async () => {
    const resolveWorktreeConflict = vi.fn(async () => ({
      resolved: true as const,
      agentId: 'judge',
      outcome: 'merged' as const
    }))
    installApi({ getWorktreeConflictDiff: vi.fn(async () => DIFF), resolveWorktreeConflict })
    await renderView()
    await ouvrirComparaison()

    await act(async () => {
      ;(container?.querySelector('[data-testid="wt-keep-agent"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(resolveWorktreeConflict).toHaveBeenCalledWith('judge', 'agent')
    expect(container?.querySelector('[data-testid="wt-conflict-diff"]')).toBeNull()
    expect(
      container?.querySelector('[data-testid="wt-conflict-resolution"]')?.textContent
    ).toContain('Version de l’agent appliquée')
  })

  it('un refus du processus principal est affiché sans prétendre avoir résolu', async () => {
    installApi({
      resolveWorktreeConflict: vi.fn(async () => ({
        resolved: false as const,
        reason: 'blocked' as const
      }))
    })
    await renderView()

    await act(async () => {
      ;(container?.querySelector('[data-testid="wt-keep-mine"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container?.querySelector('[data-testid="wt-office-error"]')?.textContent).toContain(
      'Résolution refusée'
    )
    expect(container?.querySelector('[data-testid="wt-conflict-resolution"]')).toBeNull()
  })
})

describe('WorktreeView — glisser-deposer dans le graphe', () => {
  /*
    DEMANDE (2026-09-15) : « j'aimerais pouvoir drag and drop les points et que la bonne commande
    soit appelee en fond ».

    « En fond » ne veut pas dire « sans le dire » : un relachement de souris au mauvais endroit est
    l'accident le plus banal qui soit, et une commande git partie toute seule ne se reprend pas. Le
    geste PROPOSE donc la commande exacte, et c'est la confirmation qui la lance.
  */
  const glisser = (source: Element, cible: Element): void => {
    act(() => {
      source.dispatchEvent(new Event('dragstart', { bubbles: true }))
      cible.dispatchEvent(new Event('dragover', { bubbles: true, cancelable: true }))
      cible.dispatchEvent(new Event('drop', { bubbles: true, cancelable: true }))
    })
  }

  const badge = (libelle: string): Element =>
    [...(container?.querySelectorAll('[data-testid="git-ref-badge"]') ?? [])].find(
      (element) => element.textContent === libelle
    )!

  it('une branche deposee sur une autre PROPOSE la fusion et ne lance RIEN', async () => {
    const api = installApi()
    await renderView()

    glisser(badge('feat/cockpit'), badge('main'))

    const confirmation = container?.querySelector('[data-testid="git-geste-confirmation"]')
    expect(confirmation).not.toBeNull()
    // La commande EXACTE, pas une paraphrase : c'est elle qui partira.
    expect(container?.querySelector('[data-testid="git-geste-commande"]')?.textContent).toBe(
      'git checkout main && git merge --no-ff feat/cockpit'
    )
    expect(api.runGitAction).not.toHaveBeenCalled()
  })

  it('la confirmation lance le geste, avec le depot affiche', async () => {
    const api = installApi()
    await renderView()
    glisser(badge('feat/cockpit'), badge('main'))

    await act(async () => {
      ;(container?.querySelector('[data-testid="git-geste-lancer"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api.runGitAction).toHaveBeenCalledWith(
      { type: 'merge', source: 'feat/cockpit', cible: 'main' },
      undefined
    )
    expect(container?.querySelector('[data-testid="git-geste-resultat"]')?.textContent).toContain(
      'Merge made'
    )
  })

  it('Annuler referme la proposition sans rien lancer', async () => {
    const api = installApi()
    await renderView()
    glisser(badge('feat/cockpit'), badge('main'))

    act(() => {
      ;(container?.querySelector('[data-testid="git-geste-annuler"]') as HTMLButtonElement).click()
    })

    expect(container?.querySelector('[data-testid="git-geste-confirmation"]')).toBeNull()
    expect(api.runGitAction).not.toHaveBeenCalled()
  })

  it('un COMMIT depose sur une branche propose de le rapporter', async () => {
    // Empreintes REELLES ici : le reste du fichier travaille avec des hashs lisibles (« 5d5cc22full »),
    // mais la liste blanche exige une vraie empreinte — `HEAD~1` et `--force` sont des chaines eux
    // aussi. Un fixture irrealiste aurait fait passer ce test pour un defaut du code.
    installApi({
      getGitGraph: vi.fn(async () => ({
        ...snapshot,
        commits: [
          { ...snapshot.commits[0], hash: '46285c3aa11bb22cc33', refs: ['HEAD -> main'] },
          { ...snapshot.commits[1], hash: '5d5cc22ff99ee88dd77', parents: [], refs: [] }
        ]
      }))
    })
    await renderView()

    // Le POINT du graphe porte lui aussi `data-commit` et vient AVANT dans le document : viser la
    // ligne, qui est la prise reelle (le SVG est en `pointer-events: none`, il ne se saisit pas).
    const ligne = container!.querySelector(
      '[data-testid="git-commit-row"][data-commit="5d5cc22ff99ee88dd77"]'
    )!
    glisser(ligne, badge('main'))

    expect(container?.querySelector('[data-testid="git-geste-commande"]')?.textContent).toBe(
      'git checkout main && git cherry-pick 5d5cc22ff99ee88dd77'
    )
  })

  /** CAS LIMITE — une empreinte qui n'en est pas une : refus NOMME, aucune commande proposee. */
  it('refuse de rapporter ce qui n’est pas une empreinte de commit', async () => {
    const api = installApi()
    await renderView()

    // Les commits du fixture portent « …full » : ce ne sont pas des empreintes valides.
    glisser(
      container!.querySelector('[data-testid="git-commit-row"][data-commit="5d5cc22full"]')!,
      badge('main')
    )

    expect(container?.querySelector('[data-testid="git-geste-confirmation"]')).toBeNull()
    expect(container?.querySelector('[data-testid="git-geste-refus"]')?.textContent).toContain(
      'Empreinte de commit invalide'
    )
    expect(api.runGitAction).not.toHaveBeenCalled()
  })

  /** CAS LIMITE — deposer une branche sur elle-meme : refus NOMME, aucune proposition. */
  it('refuse de fusionner une branche dans elle-meme', async () => {
    const api = installApi()
    await renderView()

    glisser(badge('main'), badge('main'))

    expect(container?.querySelector('[data-testid="git-geste-confirmation"]')).toBeNull()
    expect(container?.querySelector('[data-testid="git-geste-refus"]')?.textContent).toContain(
      'elle-meme'
    )
    expect(api.runGitAction).not.toHaveBeenCalled()
  })

  /** CAS LIMITE — une branche DISTANTE n'est pas une cible : s'y placer detacherait la tete. */
  it('n’accepte pas un depot sur une etiquette distante', async () => {
    const api = installApi({
      getGitGraph: vi.fn(async () => ({
        ...snapshot,
        commits: [
          { ...snapshot.commits[0], refs: ['HEAD -> main'] },
          { ...snapshot.commits[1], refs: ['origin/feat/cockpit'] }
        ]
      }))
    })
    await renderView()

    glisser(badge('main'), badge('origin/feat/cockpit'))

    expect(container?.querySelector('[data-testid="git-geste-confirmation"]')).toBeNull()
    expect(api.runGitAction).not.toHaveBeenCalled()
  })

  /** CAS LIMITE — git refuse (arbre sale) : le motif est AFFICHE, pas avale. */
  it('affiche le refus de git au lieu de le taire', async () => {
    const api = installApi({
      runGitAction: vi.fn(async () => ({
        ok: false as const,
        raison: 'git checkout main a échoué : error: Your local changes would be overwritten'
      }))
    })
    await renderView()
    glisser(badge('feat/cockpit'), badge('main'))

    await act(async () => {
      ;(container?.querySelector('[data-testid="git-geste-lancer"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(api.runGitAction).toHaveBeenCalled()
    expect(container?.querySelector('[data-testid="git-geste-resultat"]')?.textContent).toContain(
      'would be overwritten'
    )
  })
})
