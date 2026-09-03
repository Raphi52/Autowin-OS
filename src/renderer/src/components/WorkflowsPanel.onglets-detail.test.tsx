// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsPanel, type WorkflowsPanelProps } from './WorkflowsPanel'
import type { RunEntry } from './ChatView'
import type { OrchStep } from './chat-view-model'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./SourceControlPane', () => ({
  SourceControlPane: () => <div data-testid="source-control-stub" />
}))
vi.mock('./WorkflowExecutionGraph', () => ({
  WorkflowExecutionGraph: () => <div data-testid="graph-stub" />
}))

const steps: OrchStep[] = [
  {
    step: 'exec',
    role: 'build',
    detail: 'phase build',
    status: 'failed',
    error: '⛔ Bloqué : dépendance absente',
    thinking: 'J’essaie une autre piste.'
  }
]

const runEntry: RunEntry = {
  subject: 'Suivi du run',
  session: 'attaché',
  path: '/runs/one/RUN.md',
  mtime: 1,
  summary: { status: 'red', dodTotal: 3, dodChecked: 1, journalEvents: 2, defauts: 1 }
}

function props(over: Partial<WorkflowsPanelProps> = {}): WorkflowsPanelProps {
  return {
    runsPaneWidth: 320,
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
    runs: [runEntry],
    openRun: { path: runEntry.path, content: '## Besoin\nX' },
    viewRun: vi.fn(),
    setOpenRun: vi.fn(),
    setOpenTrace: vi.fn(),
    requestDeleteRun: vi.fn(),
    openTrace: steps,
    runDetailTab: 'trace',
    setRunDetailTab: vi.fn(),
    liveRunCardRef: { current: null },
    messages: [],
    ...over
  }
}

/**
 * Choix utilisateur du 03/09 : l'onglet « Avancée » est RETIRÉ du détail d'un RUN. Ce test garde
 * la suppression — il échoue si l'onglet revient — et vérifie que les deux onglets restants
 * fonctionnent toujours.
 */
describe('WorkflowsPanel — onglets du détail d’un RUN', () => {
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

  function ouvrirRuns(): void {
    const onglet = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    ).find((b) => b.textContent?.trim() === 'Runs')
    if (!onglet) throw new Error('onglet Runs introuvable')
    act(() => onglet.click())
  }

  function onglets(): (string | null)[] {
    return Array.from(container.querySelectorAll('.run-detail-tab')).map((t) => t.textContent)
  }

  it('n’offre plus « Avancée » : seuls le fil des sous-agents et RUN.md restent', () => {
    act(() => root.render(<WorkflowsPanel {...props()} />))
    ouvrirRuns()
    expect(onglets()).toEqual(['Fil des sous-agents', 'RUN.md'])
    expect(onglets()).not.toContain('Avancée')
    expect(container.querySelector('[data-testid="run-progress-step"]')).toBeNull()
  })

  it('rend le fil des sous-agents sur l’onglet par défaut', () => {
    act(() => root.render(<WorkflowsPanel {...props()} />))
    ouvrirRuns()
    expect(container.textContent).toContain('⛔ Bloqué : dépendance absente')
  })

  it('rend le fichier produit sur l’onglet RUN.md', () => {
    act(() => root.render(<WorkflowsPanel {...props({ runDetailTab: 'runmd' })} />))
    ouvrirRuns()
    expect(container.querySelector('[data-testid="run-summary"]')).not.toBeNull()
  })
})
