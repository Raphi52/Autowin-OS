// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsPanel, type WorkflowsPanelProps } from './WorkflowsPanel'
import type { MessageEntreFilsVu } from './MessagesEntreFils'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('./SourceControlPane', () => ({ SourceControlPane: () => <div /> }))
vi.mock('./ProjectPane', () => ({ ProjectPane: () => <div /> }))
vi.mock('./WorkflowExecutionGraph', () => ({ WorkflowExecutionGraph: () => <div /> }))

/*
 * conv-1139 (2026-10-25, « ranges ce bloc dans Détails > Runs ») : les messages entre agents de
 * fils du même dépôt quittent le dessus de la zone de saisie pour l'onglet Runs du panneau Détails.
 */
const ordre: MessageEntreFilsVu = {
  id: 'msg-1',
  sens: 'recu',
  autreFil: 'conv-1140',
  nature: 'ordre',
  texte: 'Test : réponds-moi en recopiant exactement le code CODE-xilgwn.',
  at: Date.UTC(2026, 9, 25, 7, 30),
  livre: true,
  hypothese: false
}

function props(): WorkflowsPanelProps {
  return {
    runsPaneWidth: 320,
    messages: [],
    beginRunsResize: vi.fn(),
    setShowRuns: vi.fn(),
    activeId: 'conv-1141',
    send: vi.fn(),
    isActive: true,
    requestLabel: undefined,
    liveGraphActive: false,
    visibleLiveRuns: [],
    runs: [],
    openRun: null,
    viewRun: vi.fn(),
    relireRunOuvert: vi.fn(),
    setOpenRun: vi.fn(),
    setOpenTrace: vi.fn(),
    requestDeleteRun: vi.fn(),
    openTrace: null,
    runDetailTab: 'trace',
    setRunDetailTab: vi.fn(),
    liveRunCardRef: { current: null }
  }
}

describe('WorkflowsPanel — messages entre fils dans l’onglet Runs', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    ;(globalThis as unknown as { window: Record<string, unknown> }).window.api = {
      messagesEntreFils: (id: string) => Promise.resolve(id === 'conv-1141' ? [ordre] : []),
      onAppEvent: () => () => undefined
    }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
  })

  const onglet = (libelle: string): HTMLButtonElement => {
    const bouton = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    ).find((b) => b.textContent?.trim() === libelle)
    if (!bouton) throw new Error(`onglet ${libelle} introuvable`)
    return bouton
  }

  it('l’onglet Runs montre les messages reçus et envoyés par ce fil', async () => {
    await act(async () => root.render(<WorkflowsPanel {...props()} />))
    await act(async () => onglet('Runs').click())
    const bloc = container.querySelector('section[aria-label="Messages entre fils"]')
    expect(bloc).not.toBeNull()
    expect(bloc?.textContent).toContain('avec conv-1140')
    expect(bloc?.textContent).toContain('CODE-xilgwn')
  })

  it('les autres onglets ne le montrent pas', async () => {
    await act(async () => root.render(<WorkflowsPanel {...props()} />))
    await act(async () => onglet('Graph').click())
    expect(container.querySelector('section[aria-label="Messages entre fils"]')).toBeNull()
  })
})
