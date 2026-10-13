// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsPanel, type WorkflowsPanelProps } from './WorkflowsPanel'
import type { RunEntry } from './ChatView'
import type { RunClosureObservation } from '../../../shared/run-execution'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * LE NŒUD « CLÔTURE DU RUN » OUVRE LE BILAN DU RUN, PLUS LA LISTE DES FICHIERS.
 *
 * Constaté le 2026-10-13 (capture de l'utilisateur) : cliquer ce nœud montrait « Modifiés par
 * cette conversation », exactement le contenu de l'onglet Files. Choix de l'utilisateur : « Le
 * bilan du run : verdict, raisons du refus ou de l'acceptation, coût et durée, lien vers son
 * RUN.md (plus de liste de fichiers en dessous) ».
 */

vi.mock('./SourceControlPane', () => ({
  SourceControlPane: () => <div data-testid="source-control-stub" />
}))

let closureChoisie: RunClosureObservation = { status: 'open', totalDurationMs: 0, totalCostUsd: 0 }
let verdictsChoisis: string[] | undefined

vi.mock('./WorkflowExecutionGraph', () => ({
  WorkflowExecutionGraph: ({
    onSelect
  }: {
    onSelect?: (selection: Record<string, unknown> | null) => void
  }) => (
    <div data-testid="graph-stub">
      <button
        data-testid="pick-closure"
        onClick={() =>
          onSelect?.({
            id: 'closure:run-1',
            kind: 'closure',
            runId: 'run-1',
            closure: closureChoisie,
            ...(verdictsChoisis ? { verdictEventIds: verdictsChoisis } : {})
          })
        }
      />
      <button data-testid="pick-git" onClick={() => onSelect?.({ id: 'git:run-1', kind: 'git' })} />
    </div>
  )
}))

const REPONSE_DU_JUGE = [
  'Je relance les tests cités pour avoir un code de sortie.',
  '',
  'VALIDE',
  '',
  'SCORE: 91',
  'OBJECTIONS:',
  '- OK: tests rejoués, 12/12, code 0.'
].join('\n')

function baseProps(overrides: Partial<WorkflowsPanelProps> = {}): WorkflowsPanelProps {
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
    liveRunCardRef: { current: null },
    ...overrides
  }
}

function runMd(overrides: Partial<RunEntry> = {}): RunEntry {
  return {
    subject: 'corrige-le-bouton-mv6h34eh',
    session: 'conv-1',
    path: 'D:\\data\\runs\\conv-1\\corrige-le-bouton-mv6h34eh-workspace\\RUN.md',
    mtime: 1,
    summary: { status: 'green', dodTotal: 1, dodChecked: 1, journalEvents: 2, defauts: 0 },
    ...overrides
  }
}

describe('WorkflowsPanel — bilan du nœud « Clôture du run »', () => {
  let container: HTMLDivElement
  let root: Root
  let charges: ReturnType<typeof vi.fn>

  beforeEach(() => {
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    verdictsChoisis = undefined
    charges = vi.fn(async (_conversation: string, ids: string[]) =>
      Object.fromEntries(
        ids.map((id) => [id, [{ kind: 'model-response', content: REPONSE_DU_JUGE }]])
      )
    )
    ;(window as unknown as { api: Record<string, unknown> }).api = {
      causalTraceGraphe: vi.fn(),
      causalTraceCharges: charges
    }
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    delete (window as unknown as { api?: unknown }).api
  })

  function render(props: WorkflowsPanelProps): void {
    act(() => {
      root.render(<WorkflowsPanel {...props} />)
    })
  }

  async function choisirCloture(): Promise<void> {
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="pick-closure"]')!.click()
    })
  }

  it('n’ouvre plus la liste des fichiers : le bilan prend sa place', async () => {
    closureChoisie = { status: 'green', totalDurationMs: 65_000, totalCostUsd: 1.234 }
    render(baseProps())
    await choisirCloture()
    expect(container.querySelector('[data-testid="source-control-stub"]')).toBeNull()
    expect(
      container.querySelector('.workflow-panel-detail')?.getAttribute('data-workflow-detail')
    ).toBe('bilan-run')
    expect(container.querySelector('[data-testid="run-bilan-verdict"]')?.textContent).toBe('vert')
    const lignes = Array.from(container.querySelectorAll('[data-testid="run-bilan-ligne"]')).map(
      (ligne) => ligne.textContent
    )
    expect(lignes).toEqual(['Clôtureacceptée', 'Durée1 min 05 s', 'Coût1.23 $'])
  })

  it('un nœud git ouvre TOUJOURS Source control — discriminant', async () => {
    render(baseProps())
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-testid="pick-git"]')!.click()
    })
    expect(container.querySelector('[data-testid="source-control-stub"]')).not.toBeNull()
    expect(container.querySelector('[data-bilan-cloture]')).toBeNull()
  })

  it('un run accepté donne le verdict final du juge comme raison', async () => {
    closureChoisie = { status: 'green', totalDurationMs: 1_000, totalCostUsd: 0.1, gateReasons: [] }
    verdictsChoisis = ['juge-1', 'juge-2']
    render(baseProps())
    await choisirCloture()
    // Seul le DERNIER passage est relu : c'est lui qui a clos le run.
    expect(charges).toHaveBeenCalledWith('conv-1', ['juge-2'], ['model-response'])
    expect(container.querySelector('[data-bilan-raisons]')?.textContent).toContain(
      'Pourquoi accepté'
    )
    const juge = container.querySelector('[data-bilan-juge]')
    expect(juge?.getAttribute('data-bilan-juge')).toBe('valide')
    expect(juge?.textContent).toContain('VALIDE')
    expect(juge?.textContent).toContain('score 91/100')
    expect(juge?.textContent).toContain('tests rejoués, 12/12, code 0.')
  })

  it('un run refusé liste les motifs du contrôle final', async () => {
    closureChoisie = {
      status: 'red',
      totalDurationMs: 1_000,
      totalCostUsd: 0.1,
      gateReasons: ['blocage d’intégration: conflit sur src/a.ts']
    }
    render(baseProps())
    await choisirCloture()
    expect(container.querySelector('[data-testid="run-bilan-verdict"]')?.textContent).toBe('rouge')
    expect(container.querySelector('[data-bilan-raisons]')?.textContent).toContain(
      'Pourquoi refusé'
    )
    expect(container.querySelector('[data-bilan-motifs]')?.textContent).toContain(
      'conflit sur src/a.ts'
    )
  })

  it('un run ouvert le dit, sans durée ni coût présentés comme mesurés', async () => {
    closureChoisie = { status: 'open', totalDurationMs: 0, totalCostUsd: 0 }
    render(baseProps())
    await choisirCloture()
    const lignes = Array.from(container.querySelectorAll('[data-testid="run-bilan-ligne"]')).map(
      (ligne) => ligne.textContent
    )
    expect(lignes).toEqual(['Clôturepas encore close'])
    expect(container.querySelector('[data-bilan-raisons]')?.textContent).toContain(
      'n’est pas encore clos'
    )
  })

  it('le lien RUN.md déplie CE run dans l’onglet Runs, sur son RUN.md', async () => {
    const entree = runMd()
    const viewRun = vi.fn()
    const setRunDetailTab = vi.fn()
    closureChoisie = {
      status: 'green',
      totalDurationMs: 1_000,
      totalCostUsd: 0.1,
      // Même fichier, autre casse et autres séparateurs : l'appariement ne doit pas en dépendre.
      runPath: 'd:/data/runs/conv-1/corrige-le-bouton-mv6h34eh-workspace/RUN.md'
    }
    render(
      baseProps({
        runs: [runMd({ path: '/ailleurs/RUN.md', subject: 'autre' }), entree],
        viewRun,
        setRunDetailTab
      })
    )
    await choisirCloture()
    expect(container.querySelector('.run-bilan__titre')?.textContent).toBe('Corrige le bouton')
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[data-bilan-ouvrir-runmd]')!.click()
    })
    expect(viewRun).toHaveBeenCalledWith(entree)
    expect(setRunDetailTab).toHaveBeenLastCalledWith('runmd')
    const ongletActif = container.querySelector('button[role="tab"][aria-selected="true"]')
    expect(ongletActif?.textContent?.trim()).toBe('Runs')
  })

  it('sans chemin de RUN.md dans la trace, le dit au lieu d’apparier au hasard', async () => {
    closureChoisie = { status: 'green', totalDurationMs: 1_000, totalCostUsd: 0.1 }
    render(baseProps({ runs: [runMd()] }))
    await choisirCloture()
    expect(container.querySelector('[data-bilan-ouvrir-runmd]')).toBeNull()
    expect(container.querySelector('[data-bilan-runmd]')?.textContent).toContain(
      'avant que la trace garde le chemin'
    )
  })
})
