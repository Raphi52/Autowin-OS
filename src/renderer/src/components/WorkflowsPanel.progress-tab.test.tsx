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
    runDetailTab: 'progress',
    setRunDetailTab: vi.fn(),
    liveRunCardRef: { current: null },
    ...over
  }
}

describe('WorkflowsPanel — onglet Avancée', () => {
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

  it('propose l’onglet Avancée et y rend le suivi du run', () => {
    act(() => root.render(<WorkflowsPanel {...props()} />))
    const tabs = Array.from(container.querySelectorAll('.run-detail-tab')).map((t) => t.textContent)
    expect(tabs).toContain('Avancée')
    expect(container.querySelectorAll('[data-testid="run-progress-step"]')).toHaveLength(1)
    expect(container.textContent).toContain('⛔ Bloqué : dépendance absente')
  })

  it('sur l’onglet RUN.md, le suivi cède la place au fichier rendu', () => {
    act(() => root.render(<WorkflowsPanel {...props({ runDetailTab: 'runmd' })} />))
    expect(container.querySelector('[data-testid="run-progress-step"]')).toBeNull()
    expect(container.querySelector('[data-testid="run-summary"]')).not.toBeNull()
  })
})
