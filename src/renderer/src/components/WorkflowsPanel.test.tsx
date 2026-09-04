// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsPanel, type WorkflowsPanelProps } from './WorkflowsPanel'
import type { RunEntry } from './ChatView'
import type { OrchStep, ScopedLiveRun } from './chat-view-model'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./SourceControlPane', () => ({
  SourceControlPane: () => <div data-testid="source-control-stub" />
}))
// Le stub PUBLIE une sélection, comme le vrai graphe : c'est par là que le panneau est piloté
// depuis que les onglets ont disparu. Sans ce levier, aucun test ne pourrait descendre dans le
// détail contextuel.
vi.mock('./WorkflowExecutionGraph', () => ({
  WorkflowExecutionGraph: ({
    onSelect
  }: {
    onSelect?: (selection: { id: string; kind: string; turnId?: string } | null) => void
  }) => (
    <div data-testid="graph-stub">
      <button data-testid="pick-git" onClick={() => onSelect?.({ id: 'git:run-1', kind: 'git' })} />
      <button
        data-testid="pick-agent"
        onClick={() => onSelect?.({ id: 'agent-1', kind: 'agent', turnId: 'turn-1' })}
      />
      <button data-testid="pick-none" onClick={() => onSelect?.(null)} />
    </div>
  )
}))

function baseProps(overrides: Partial<WorkflowsPanelProps> = {}): WorkflowsPanelProps {
  return {
    runsPaneWidth: 320,
    messages: [],
    beginRunsResize: vi.fn(),
    refreshRuns: vi.fn(),
    setShowRuns: vi.fn(),
    activeId: 'conv-1',
    send: vi.fn(),
    isActive: true,
    requestLabel: undefined,
    liveGraphActive: false,
    visibleLiveRuns: [],
    checkpoints: [],
    forkedCheckpoint: '',
    setForkedCheckpoint: vi.fn(),
    runs: [],
    openRun: null,
    viewRun: vi.fn(),
    setOpenRun: vi.fn(),
    setOpenTrace: vi.fn(),
    requestDeleteRun: vi.fn(),
    openTrace: null,
    runDetailTab: 'trace',
    setRunDetailTab: vi.fn(),
    liveRunCardRef: { current: null },
    ...overrides
  }
}

function run(overrides: Partial<RunEntry> = {}): RunEntry {
  return {
    subject: 'Audit du panneau',
    session: 'attaché',
    path: '/runs/one/RUN.md',
    mtime: 1,
    summary: {
      status: 'green',
      dodTotal: 4,
      dodChecked: 4,
      journalEvents: 2,
      defauts: 0
    },
    ...overrides
  }
}

describe('WorkflowsPanel', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: WorkflowsPanelProps): void {
    act(() => {
      root.render(<WorkflowsPanel {...props} />)
    })
  }

  /**
   * Les RUN.md ne sont plus l'accueil du panneau : depuis le retour des trois onglets
   * (Graph / Runs / Logs), ils vivent sous « Runs ». Les tests qui les LISENT doivent donc y
   * aller — c'est une etape de navigation ajoutee, aucune assertion n'est relachee.
   */
  function ouvrirRuns(): void {
    const onglet = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(
      (b) => b.textContent?.trim() === 'Runs'
    )
    if (!onglet) throw new Error('onglet Runs introuvable')
    act(() => onglet.click())
  }

  /**
   * TROIS ONGLETS, PAS QUATRE, ET LE GRAPHE RESTE LA NAVIGATION DU DETAIL.
   *
   * Ce test remplace celui qui INTERDISAIT toute barre d'onglets. L'interdiction datait de la
   * substitution des quatre projections par le graphe ; l'utilisateur a redemande une separation
   * le 2026-09-01, mais SEULEMENT entre les trois objets empiles (graphe, RUN.md, trace). Le
   * drill-down du graphe n'est pas defait : il est verifie par les tests de selection plus bas.
   */
  it('expose exactement trois onglets — Graph, Runs, Logs — et monte le graphe par defaut', () => {
    render(baseProps())
    const onglets = Array.from(container.querySelectorAll('button[role="tab"]')).map((b) =>
      b.textContent?.trim()
    )
    expect(onglets).toEqual(['Graph', 'Runs', 'Logs'])
    expect(container.querySelector('[role="tablist"]')).not.toBeNull()
    // Le graphe est l'onglet d'accueil : le panneau s'ouvre sur l'execution, pas sur une liste.
    expect(container.querySelector('[data-testid="graph-stub"]')).not.toBeNull()
    expect(
      container.querySelector('button[role="tab"][aria-selected="true"]')?.textContent?.trim()
    ).toBe('Graph')
  })

  /** Chaque onglet montre SON objet, et lui seul : c'est tout le point de la separation. */
  it('bascule d’un objet à l’autre : le graphe cède la place aux RUN.md puis aux logs', () => {
    render(baseProps({ runs: [run()] }))
    expect(container.textContent).not.toContain('Audit du panneau')

    ouvrirRuns()
    expect(container.querySelector('[data-testid="graph-stub"]')).toBeNull()
    expect(container.textContent).toContain('Audit du panneau')

    const logs = Array.from(container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')).find(
      (b) => b.textContent?.trim() === 'Logs'
    )!
    act(() => logs.click())
    expect(container.textContent).not.toContain('Audit du panneau')
    expect(container.querySelector('[data-testid="model-activity-log"]')).not.toBeNull()
  })

  it('rend un run avec sa progression DoD', () => {
    render(baseProps({ runs: [run()] }))
    ouvrirRuns()
    expect(container.textContent).toContain('Audit du panneau')
    expect(container.textContent).toContain('4/4')
    expect(container.querySelector('.status-dot.st-ok')).not.toBeNull()
  })

  /*
   * LA DoD DEMANDAIT « un test de composant avec les deux cas » — il n'existait pas.
   *
   * Mesure du 21/08 en rouvrant le RUN.md du 27/07 reste ouvert a la racine : la carte AFFICHE bien
   * les compteurs (WorkflowsPanel.tsx:330), la fixture de ce fichier les PORTE deja
   * (`journalEvents`, `defauts`)... et aucune assertion ne les vérifiait. Une fixture n'est pas une
   * preuve : le compteur pouvait disparaitre du rendu sans qu'un seul test tombe.
   */
  it('affiche les compteurs Journal et Défauts de la carte, dans les deux cas', () => {
    render(baseProps({ runs: [run()] }))
    ouvrirRuns()
    expect(container.textContent).toContain('J 2')
    expect(container.textContent).toContain('D 0')

    // Second cas : un run qui PORTE des defauts doit les montrer, pas seulement le zero rassurant.
    render(
      baseProps({
        runs: [
          run({
            summary: { status: 'red', dodTotal: 4, dodChecked: 1, journalEvents: 7, defauts: 3 }
          })
        ]
      })
    )
    ouvrirRuns()
    expect(container.textContent).toContain('J 7')
    expect(container.textContent).toContain('D 3')
  })

  it('affiche le message vide quand aucune conversation active n’a de run', () => {
    render(baseProps({ runs: [], activeId: null }))
    ouvrirRuns()
    expect(container.textContent).toContain(
      'Sélectionne ou démarre une conversation pour voir ses RUN.md.'
    )
  })

  /** Descendre sur un nœud qui parle du DÉPÔT ouvre Source control, sans changer de vue. */
  it('ouvre Source control quand on descend sur un nœud git', () => {
    render(baseProps({ runs: [run()] }))
    expect(container.querySelector('[data-testid="source-control-stub"]')).toBeNull()

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="pick-git"]')?.click())

    expect(container.querySelector('[data-testid="source-control-stub"]')).not.toBeNull()
    expect(
      container.querySelector('[data-workflow-detail]')?.getAttribute('data-workflow-detail')
    ).toBe('source-control')
    // La liste des RUN.md cède la place : une seule chose à lire à la fois.
    expect(container.textContent).not.toContain('Audit du panneau')
  })

  /**
   * LE FIL DES SOUS-AGENTS EST DANS L'ONGLET RUNS — demande utilisateur repetee (2026-09-01).
   *
   * Il s'ouvrait SOUS le graphe, dans l'onglet Graph. Descendre sur un noeud d'agent bascule
   * desormais sur Runs et y montre le fil du tour choisi ; le graphe redevient une navigation
   * pure. Le retour au graphe se fait par son onglet.
   */
  it('descendre sur un nœud agent bascule sur Runs et y ouvre le fil des sous-agents', () => {
    render(baseProps({ runs: [run()] }))

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="pick-agent"]')?.click())
    expect(
      container.querySelector('button[role="tab"][aria-selected="true"]')?.textContent?.trim()
    ).toBe('Runs')
    expect(
      container.querySelector('[data-workflow-detail]')?.getAttribute('data-workflow-detail')
    ).toBe('subagents')
    expect(container.textContent).toContain('Aucun fil de sous-agents pour cette étape')
    // Le graphe n'est plus a l'ecran : un objet par onglet, c'est tout le point de la separation.
    expect(container.querySelector('[data-testid="graph-stub"]')).toBeNull()
    // Les RUN.md restent sur le meme onglet, sous le fil.
    expect(container.textContent).toContain('Audit du panneau')

    const graphe = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    ).find((b) => b.textContent?.trim() === 'Graph')!
    act(() => graphe.click())
    expect(container.querySelector('[data-testid="graph-stub"]')).not.toBeNull()
    // L'onglet Graph ne rend plus AUCUN fil : c'etait le doublon a supprimer.
    expect(container.textContent).not.toContain('Aucun fil de sous-agents pour cette étape')
  })

  /** Le fil affiché est celui du TOUR sélectionné — le seul appariement réellement disponible. */
  it('n’affiche que le fil apparié au tour du nœud choisi', () => {
    const fil = (runPath: string, task: string): [string, ScopedLiveRun<OrchStep>] => [
      runPath,
      { convId: 'conv-1', runPath, task, steps: [], status: 'green' }
    ]
    render(
      baseProps({
        visibleLiveRuns: [fil('turn-1', 'fil du tour vise'), fil('turn-9', 'fil d’un autre tour')]
      })
    )

    act(() => container.querySelector<HTMLButtonElement>('[data-testid="pick-agent"]')?.click())

    expect(container.textContent).toContain('fil du tour vise')
    expect(container.textContent).not.toContain('fil d’un autre tour')
  })

  it('un clic sur Fermer appelle setShowRuns(false)', () => {
    const setShowRuns = vi.fn()
    render(baseProps({ setShowRuns }))
    const closeButton = container.querySelector('.workflow-panel-close') as HTMLButtonElement | null
    expect(closeButton).not.toBeNull()
    act(() => closeButton?.click())
    expect(setShowRuns).toHaveBeenCalledWith(false)
  })
})

describe('WorkflowsPanel — ouverture d’un RUN.md', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function render(props: WorkflowsPanelProps): void {
    act(() => {
      root.render(<WorkflowsPanel {...props} />)
    })
    const onglet = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    ).find((b) => b.textContent?.trim() === 'Runs')
    if (!onglet) throw new Error('onglet Runs introuvable')
    act(() => onglet.click())
  }

  it('montre que ça charge tant que le contenu n’est pas arrivé', () => {
    render(
      baseProps({
        runs: [run()],
        openRun: { path: '/runs/one/RUN.md', content: '', pending: true },
        runDetailTab: 'runmd'
      })
    )
    expect(container.querySelector('[data-testid="run-detail-loading"]')).not.toBeNull()
    expect(container.querySelector('.run-inspector')).toBeNull()
  })

  it('affiche l’échec de lecture comme une erreur, pas comme le contenu du run', () => {
    render(
      baseProps({
        runs: [run()],
        openRun: { path: '/runs/one/RUN.md', content: '', error: 'ENOENT: fichier absent' },
        runDetailTab: 'runmd'
      })
    )
    const erreur = container.querySelector('[data-testid="run-detail-error"]')
    expect(erreur?.textContent).toContain('ENOENT')
    expect(container.querySelector('.run-inspector')).toBeNull()
  })
})
