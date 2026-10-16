// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkflowsPanel, type WorkflowsPanelProps } from './WorkflowsPanel'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

/**
 * L'OUVERTURE DU PANNEAU DETAILS DESSINE SES BORDS (conv-987, 2026-10-16 : « quand j'ouvre le
 * panneau detail je veux l'animation des border »). Le panneau n'est monte qu'a l'ouverture : son
 * montage joue l'entree du cadre, une seule fois, et sa fermeture la nettoie.
 */
const { arreter, jouerEntreeCadre } = vi.hoisted(() => {
  const arreter = vi.fn()
  return { arreter, jouerEntreeCadre: vi.fn((_cadre: Element) => arreter) }
})
vi.mock('../entree-cascade', () => ({ jouerEntreeCadre }))
/**
 * ET IL GLISSE (conv-987, « je veux une animation d'ouverture fermeture pour le paneau de droite ») :
 * le glissement lui-meme est teste dans glissement-panneau.test.ts ; ici, QUAND il est demande.
 */
const glissement = vi.hoisted(() => ({
  rend: true,
  appels: [] as Array<{ sens: string; depuisDehors?: boolean; surFin?: () => void }>,
  arrets: 0
}))
vi.mock('../glissement-panneau', () => ({
  glisserPanneau: (
    _p: Element,
    sens: string,
    options: { depuisDehors?: boolean; surFin?: () => void } = {}
  ) => {
    glissement.appels.push({ sens, ...options })
    return glissement.rend
  },
  arreterGlissement: () => {
    glissement.arrets += 1
  }
}))
vi.mock('./SourceControlPane', () => ({ SourceControlPane: () => <div /> }))
vi.mock('./WorkflowExecutionGraph', () => ({ WorkflowExecutionGraph: () => <div /> }))

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

describe('WorkflowsPanel — les bords se dessinent a l ouverture', () => {
  let container: HTMLDivElement
  let root: Root
  beforeEach(() => {
    jouerEntreeCadre.mockClear()
    arreter.mockClear()
    glissement.rend = true
    glissement.appels = []
    glissement.arrets = 0
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    ;(window as unknown as { api: Record<string, unknown> }).api = {}
  })
  afterEach(() => {
    container.remove()
    delete (window as unknown as { api?: unknown }).api
  })

  it('ouvrir joue l entree sur le panneau lui-meme, une fois ; fermer la nettoie', () => {
    act(() => root.render(<WorkflowsPanel {...props()} />))
    const panneau = container.querySelector('.runs-pane')
    expect(panneau).toBeTruthy()
    expect(jouerEntreeCadre).toHaveBeenCalledTimes(1)
    expect(jouerEntreeCadre).toHaveBeenCalledWith(panneau)
    // Un nouveau rendu (largeur tiree, runs recharges) ne rejoue pas l'entree.
    act(() => root.render(<WorkflowsPanel {...props({ runsPaneWidth: 400 })} />))
    expect(jouerEntreeCadre).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
    expect(arreter).toHaveBeenCalledTimes(1)
  })

  it('ouvrir le fait glisser depuis hors champ ; fermer le fait sortir, et ne conclut qu a la fin', () => {
    const onFermee = vi.fn()
    act(() => root.render(<WorkflowsPanel {...props({ onFermee })} />))
    expect(glissement.appels).toEqual([{ sens: 'ouverture', depuisDehors: true }])
    act(() => root.render(<WorkflowsPanel {...props({ onFermee, fermeture: true })} />))
    expect(glissement.appels[1]).toMatchObject({ sens: 'fermeture', depuisDehors: false })
    expect(onFermee).not.toHaveBeenCalled()
    act(() => glissement.appels[1].surFin?.())
    expect(onFermee).toHaveBeenCalledTimes(1)
    // Rouvert avant demontage : il repart de sa position (pas de hors champ), sans conclure.
    act(() => root.render(<WorkflowsPanel {...props({ onFermee })} />))
    expect(glissement.appels[2]).toEqual({ sens: 'ouverture', depuisDehors: false })
    act(() => root.unmount())
    expect(glissement.arrets).toBe(1)
  })

  it('si rien ne peut glisser, la fermeture conclut tout de suite (le panneau ne reste pas coince)', () => {
    glissement.rend = false
    const onFermee = vi.fn()
    act(() => root.render(<WorkflowsPanel {...props({ onFermee })} />))
    act(() => root.render(<WorkflowsPanel {...props({ onFermee, fermeture: true })} />))
    expect(onFermee).toHaveBeenCalledTimes(1)
    act(() => root.unmount())
  })
})
