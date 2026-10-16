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

/**
 * ONGLET « SORTIES ENTIERES » DU RUN DEPLIE (conv-989, 2026-10-16).
 *
 * Le fil des sous-agents montre chaque etape coupee a 4 000 caracteres (`trace.json`). Quand la
 * sortie entiere existe a cote du RUN.md, le panneau la propose dans un onglet a part.
 */
vi.mock('./SourceControlPane', () => ({ SourceControlPane: () => <div /> }))
vi.mock('./WorkflowExecutionGraph', () => ({ WorkflowExecutionGraph: () => <div /> }))

const RUN: RunEntry = {
  subject: 'pistes-mv6h34eh',
  session: 'conv-1',
  path: 'D:\\data\\runs\\conv-1\\pistes-mv6h34eh-workspace\\RUN.md',
  mtime: 1,
  summary: { status: 'green', dodTotal: 1, dodChecked: 1, journalEvents: 2, defauts: 0 }
}
const FIL = [
  { step: 'exec', role: 'subagent', detail: 'scout', text: 'début coupé…' }
] as unknown as OrchStep[]

function props(overrides: Partial<WorkflowsPanelProps> = {}): WorkflowsPanelProps {
  return {
    runsPaneWidth: 320,
    messages: [],
    beginRunsResize: vi.fn(),
    setShowRuns: vi.fn(),
    activeId: 'conv-1',
    send: vi.fn(),
    isActive: true,
    requestLabel: undefined,
    liveGraphActive: false,
    visibleLiveRuns: [],
    runs: [RUN],
    openRun: { path: RUN.path, content: '# RUN', mtime: 1 },
    viewRun: vi.fn(),
    relireRunOuvert: vi.fn(),
    setOpenRun: vi.fn(),
    setOpenTrace: vi.fn(),
    requestDeleteRun: vi.fn(),
    openTrace: FIL,
    runDetailTab: 'trace',
    setRunDetailTab: vi.fn(),
    liveRunCardRef: { current: null },
    ongletDemande: { tab: 'runs', jeton: 1 },
    ...overrides
  }
}

describe('WorkflowsPanel — sorties entières du run', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(window as unknown as { api: Record<string, unknown> }).api = {}
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (window as unknown as { api?: unknown }).api
  })
  const onglets = (): string[] =>
    Array.from(container.querySelectorAll('.run-detail-tab')).map(
      (b) => b.textContent?.trim() ?? ''
    )

  it('avec la sortie entière : un onglet de plus, qui l’affiche', () => {
    const setRunDetailTab = vi.fn()
    act(() =>
      root.render(
        <WorkflowsPanel
          {...props({
            openRun: {
              path: RUN.path,
              content: '# RUN',
              mtime: 1,
              livrable: '## 1. étape scout\n\nFIN-DU-SCOUT'
            },
            runDetailTab: 'livrable',
            setRunDetailTab
          })}
        />
      )
    )
    expect(onglets()).toEqual(['Fil des sous-agents', 'RUN.md', 'Sorties entières'])
    expect(container.textContent).toContain('FIN-DU-SCOUT')
    act(() => {
      Array.from(container.querySelectorAll<HTMLButtonElement>('.run-detail-tab'))
        .find((b) => b.textContent?.includes('Sorties entières'))!
        .click()
    })
    expect(setRunDetailTab).toHaveBeenLastCalledWith('livrable')
  })

  it('sans sortie entière (run ancien) : les deux onglets d’avant, rien de plus', () => {
    act(() => root.render(<WorkflowsPanel {...props()} />))
    expect(onglets()).toEqual(['Fil des sous-agents', 'RUN.md'])
  })

  it('un run sans fil des sous-agents mais avec sa sortie entière : l’onglet est quand même proposé', () => {
    act(() =>
      root.render(
        <WorkflowsPanel
          {...props({
            openTrace: null,
            openRun: { path: RUN.path, content: '# RUN', mtime: 1, livrable: 'FIN-DU-SCOUT' }
          })}
        />
      )
    )
    expect(onglets()).toEqual(['RUN.md', 'Sorties entières'])
  })
})
