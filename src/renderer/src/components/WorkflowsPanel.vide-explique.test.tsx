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
    setShowRuns: vi.fn(),
    activeId: 'conv-69',
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
    // conv-1441 : depuis conv-1418, chaque demande a sa fiche ; seule une question n'en reçoit pas.
    expect(texte).toContain('seule une demande reçoit sa fiche')
    expect(texte).toContain('Observatory')
  })

  it('montre les fiches de demande du fil, et les déplie sans leur en-tête technique', async () => {
    const viewRun = vi.fn()
    const fiche = {
      chemin: 'D:/d/demandes/conv-1429/village/RUN.md',
      conversationId: 'conv-1429',
      titre: 'Construis le village commun',
      statut: 'sans-preuve' as const,
      maj: Date.UTC(2026, 10, 2, 14, 0),
      demandes: 4
    }
    const base = { ...props(), fiches: [fiche], viewRun }
    await act(async () => root.render(<WorkflowsPanel {...base} />))
    const onglet = Array.from(
      container.querySelectorAll<HTMLButtonElement>('button[role="tab"]')
    ).find((b) => b.textContent?.trim() === 'Runs')
    if (!onglet) throw new Error('onglet Runs introuvable')
    await act(async () => onglet.click())

    const texte = container.textContent ?? ''
    expect(texte).toContain('Fiches de demande')
    expect(texte).toContain('Construis le village commun')
    expect(texte).toContain('sans preuve')
    expect(texte).toContain('4 demande(s)')
    // Le fil actif (conv-69) a rangé une suite dans la fiche d'un autre fil : on dit laquelle.
    expect(texte).toContain('fiche de conv-1429')
    expect(texte).not.toContain('Aucun RUN.md pour cette conversation')
    expect(container.querySelector('.run-delete-button')).toBeNull()

    const ligne = container.querySelector<HTMLButtonElement>('[data-testid="fiche-du-fil"]')
    await act(async () => ligne?.click())
    expect(viewRun).toHaveBeenCalledWith(expect.objectContaining({ path: fiche.chemin }))

    const ouverte = {
      ...base,
      openRun: {
        path: fiche.chemin,
        content:
          'status: sans-preuve\nsession: conv-1429\n\n## Besoin\nConstruis le village commun\n'
      }
    }
    await act(async () => root.render(<WorkflowsPanel {...ouverte} />))
    const detail = container.querySelector('[data-testid="fiche-detail"]')?.textContent ?? ''
    expect(detail).toContain('Besoin')
    expect(detail).not.toContain('status:')
  })
})
