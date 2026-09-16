// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsPanel, type WorkflowsPanelProps } from './WorkflowsPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./SourceControlPane', () => ({ SourceControlPane: () => <div /> }))
vi.mock('./ProjectPane', () => ({ ProjectPane: () => <div /> }))
vi.mock('./WorkflowExecutionGraph', () => ({ WorkflowExecutionGraph: () => <div /> }))

/*
  conv-69 (2026-09-16) : vingt tours de chat direct, zero RUN.md, et l'utilisateur en conclut que la
  trace est perdue. Le message d'absence doit DIRE pourquoi il n'y en a pas et OU regarder.
*/
function props(): WorkflowsPanelProps {
  return {
    runsPaneWidth: 320,
    messages: [],
    beginRunsResize: vi.fn(),
    refreshRuns: vi.fn(),
    setShowRuns: vi.fn(),
    activeId: 'conv-69',
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
    liveRunCardRef: { current: null }
  }
}

describe('WorkflowsPanel — absence de RUN.md expliquée', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  it('dit qu un tour de chat direct n en cree pas, et ou lire la trace', async () => {
    await act(async () => root.render(<WorkflowsPanel {...props()} />))
    const onglet = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    ).find((b) => b.textContent?.trim() === 'Runs')
    if (!onglet) throw new Error('onglet Runs introuvable')
    await act(async () => onglet.click())
    const texte = container.textContent ?? ''
    expect(texte).toContain('Aucun RUN.md pour cette conversation')
    expect(texte).toContain("un tour de chat n'en crée pas")
    expect(texte).toContain('Observatory')
  })
})
