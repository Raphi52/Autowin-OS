// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsPanel, type WorkflowsPanelProps } from './WorkflowsPanel'
import type { RunEntry } from './ChatView'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./SourceControlPane', () => ({
  SourceControlPane: () => <div data-testid="source-control-stub" />
}))
vi.mock('./WorkflowExecutionGraph', () => ({
  WorkflowExecutionGraph: () => <div data-testid="graph-stub" />
}))

function baseProps(overrides: Partial<WorkflowsPanelProps> = {}): WorkflowsPanelProps {
  return {
    runsPaneWidth: 320,
    beginRunsResize: vi.fn(),
    paneTab: 'run',
    setPaneTab: vi.fn(),
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

  it('affiche les quatre onglets de section', () => {
    render(baseProps())
    const labels = Array.from(container.querySelectorAll('.workflow-section-label')).map(
      (el) => el.textContent
    )
    expect(labels).toEqual(['Sous-agents', 'Run', 'Graphe', 'Source control'])
  })

  it('rend un run avec sa progression DoD', () => {
    render(baseProps({ runs: [run()] }))
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
    expect(container.textContent).toContain('J 7')
    expect(container.textContent).toContain('D 3')
  })

  it('affiche le message vide quand aucune conversation active n’a de run', () => {
    render(baseProps({ runs: [], activeId: null }))
    expect(container.textContent).toContain(
      'Sélectionne ou démarre une conversation pour voir ses RUN.md.'
    )
  })

  it('délègue la section source-control au composant existant', () => {
    render(baseProps({ paneTab: 'source-control' }))
    expect(container.querySelector('[data-testid="source-control-stub"]')).not.toBeNull()
  })

  it('délègue la section graphe au composant existant', () => {
    render(baseProps({ paneTab: 'graph' }))
    expect(container.querySelector('[data-testid="graph-stub"]')).not.toBeNull()
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
