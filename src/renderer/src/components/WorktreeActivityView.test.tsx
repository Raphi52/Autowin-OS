// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorktreeActivityView } from './WorktreeActivityView'
import type {
  WorktreeAgentActivity,
  WorktreeRuntimeStatus
} from '../../../shared/worktree-activity-model'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root

afterEach(() => {
  act(() => root?.unmount())
  container?.remove()
})

function render(
  agents: WorktreeAgentActivity[],
  status: WorktreeRuntimeStatus = {
    available: true,
    workspacePath: 'C:\\Amitel\\Autowin OS',
    repoId: 'repo-a'
  },
  onResolveConflict?: (agentId: string) => void,
  onOpenOffice?: (path: string) => void,
  onRetryOffice?: (agentId: string) => void
): void {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  act(() =>
    root.render(
      createElement(WorktreeActivityView, {
        agents,
        status,
        onResolveConflict,
        onOpenOffice,
        onRetryOffice
      })
    )
  )
}

const offices: WorktreeAgentActivity[] = [
  {
    agentId: 'a1',
    agentName: 'Builder',
    role: 'build',
    task: 'Sécuriser la reprise',
    worktreePath: 'C:\\AppData\\worktrees\\repo-a\\agent__a1',
    state: 'working',
    verdict: 'running',
    publication: 'not-requested',
    files: [{ path: 'src/main/orchestrator.ts', kind: 'mod' }],
    startedAtMs: 1
  },
  {
    agentId: 'a2',
    agentName: 'Judge',
    role: 'judge',
    task: 'Comparer les versions',
    worktreePath: 'C:\\AppData\\worktrees\\repo-a\\agent__a2',
    state: 'conflict',
    verdict: 'green',
    publication: 'blocked',
    files: [{ path: 'src/main/os.ts', kind: 'mod' }],
    conflictFile: 'src/main/os.ts',
    startedAtMs: 2,
    endedAtMs: 3
  },
  {
    agentId: 'a3',
    agentName: 'Agent récupéré',
    role: 'build',
    task: 'Ancienne tentative',
    worktreePath: 'C:\\AppData\\worktrees\\repo-a\\agent__a3',
    state: 'ready',
    verdict: 'red',
    publication: 'not-requested',
    recovered: true,
    files: [{ path: 'src/shared/state.ts', kind: 'add' }],
    startedAtMs: 4,
    endedAtMs: 5
  }
]

describe('WorktreeActivityView — A2 Hub', () => {
  it('montre le vrai bureau principal protégé et chaque bureau agent', () => {
    render(offices)

    expect(container.querySelector('[data-testid="wt-main-office"]')?.textContent).toContain(
      'C:\\Amitel\\Autowin OS'
    )
    expect(container.querySelectorAll('[data-testid="wt-agent-office"]')).toHaveLength(3)
    expect(container.textContent).toContain('TON WORKSPACE')
    expect(container.textContent).toContain('Sécuriser la reprise')
    expect(container.textContent).toContain('agent__a1')
  })

  it('rend working, conflict et recovered sans jargon Git', () => {
    render(offices)

    expect(container.querySelector('[data-state="working"]')).toBeTruthy()
    expect(container.querySelector('[data-state="conflict"]')).toBeTruthy()
    expect(container.querySelector('[data-recovered="true"]')).toBeTruthy()
    expect(container.textContent).toContain('Récupéré après redémarrage')
    expect(container.textContent).not.toMatch(/HEAD|detached|rebase|checkout|git merge/i)
  })

  it('propose une décision seulement pour un vrai conflit', () => {
    const onResolve = vi.fn()
    render(offices, undefined, onResolve)

    const buttons = container.querySelectorAll('[data-testid="wt-resolve-conflict"]')
    expect(buttons).toHaveLength(1)
    act(() => (buttons[0] as HTMLButtonElement).click())
    expect(onResolve).toHaveBeenCalledWith('a2')
  })

  it('affiche les fichiers et la boîte des changements entrants', () => {
    render(offices)

    expect(container.textContent).toContain('src/main/orchestrator.ts')
    expect(container.querySelector('[data-testid="wt-inbox"]')?.textContent).toContain(
      'Changements entrants'
    )
    expect(container.querySelector('[data-testid="wt-inbox"]')?.textContent).toContain(
      '1 bureau à vérifier'
    )
  })

  it('rend le moteur indisponible avant toute mutation', () => {
    render([], {
      available: false,
      workspacePath: 'D:\\notes',
      reason: 'not-git'
    })

    expect(container.textContent).toContain('Protection indisponible')
    expect(container.textContent).toContain('D:\\notes')
    expect(container.textContent).toContain('mutations sont bloquées')
  })

  it('garde le bureau principal visible quand aucun agent ne travaille', () => {
    render([])

    expect(container.querySelector('[data-testid="wt-main-office"]')).toBeTruthy()
    expect(container.querySelectorAll('[data-testid="wt-agent-office"]')).toHaveLength(0)
    expect(container.textContent).toContain('Aucun bureau agent ouvert')
  })

  it('dit qu’un retour déjà publié attend seulement son rangement automatique', () => {
    render([
      {
        ...offices[0],
        state: 'ready',
        verdict: 'green',
        publication: 'cleanup-pending'
      }
    ])

    expect(container.textContent).toContain('Changements ajoutés')
    expect(container.textContent).toContain('termine le rangement seul')
    expect(container.textContent).not.toContain('Aucun fichier local n’a été touché')
  })

  it('distingue un retour publié des nouveautés plus récentes conservées', () => {
    render([
      {
        ...offices[0],
        state: 'ready',
        verdict: 'green',
        publication: 'published',
        attentionReason: 'post-publish-change',
        files: [{ path: 'late.tmp', kind: 'mod' }]
      }
    ])

    expect(container.textContent).toContain('Changements ajoutés')
    expect(container.textContent).toContain('déjà dans ton workspace')
    expect(container.textContent).toContain('plus récent reste protégé')
    expect(container.textContent).not.toContain('Aucun fichier local n’a été touché')
  })

  it('dit honnêtement quand le budget de rangement automatique est épuisé', () => {
    const onOpenOffice = vi.fn()
    render(
      [
        {
          ...offices[0],
          state: 'ready',
          verdict: 'green',
          publication: 'cleanup-pending',
          attentionReason: 'retry-exhausted',
          retryCount: 6
        }
      ],
      undefined,
      undefined,
      onOpenOffice
    )

    expect(container.textContent).toContain('rangement à vérifier')
    expect(container.textContent).toContain('Après six essais')
    expect(container.textContent).not.toContain('termine le rangement seul')
    expect(container.textContent).not.toContain('Les retours verts sont rangés automatiquement')
    expect(container.textContent).toContain('1 bureau à vérifier')
    const open = container.querySelector<HTMLButtonElement>('[data-testid="wt-open-office"]')
    expect(open).toBeTruthy()
    act(() => open!.click())
    expect(onOpenOffice).toHaveBeenCalledWith('C:\\AppData\\worktrees\\repo-a\\agent__a1')
  })

  it('ne propose pas d’ouvrir un bureau que Git doit encore recréer', () => {
    const onRetryOffice = vi.fn()
    render(
      [
        {
          ...offices[0],
          state: 'ready',
          verdict: 'green',
          publication: 'cleanup-pending',
          attentionReason: 'retry-exhausted',
          retryCount: 6,
          worktreeAvailable: false
        }
      ],
      undefined,
      undefined,
      vi.fn(),
      onRetryOffice
    )

    expect(container.textContent).toContain('rangement à vérifier')
    expect(container.querySelector('[data-testid="wt-open-office"]')).toBeNull()
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="wt-retry-office"]')
    expect(retry?.textContent).toContain('Réessayer de recréer')
    act(() => retry!.click())
    expect(onRetryOffice).toHaveBeenCalledWith('a1')
  })

  it('propose de relancer une publication épuisée quand le bureau existe', () => {
    const onRetryOffice = vi.fn()
    render(
      [
        {
          ...offices[0],
          state: 'blocked',
          verdict: 'green',
          publication: 'pending',
          attentionReason: 'retry-exhausted',
          retryCount: 6,
          worktreeAvailable: true
        }
      ],
      undefined,
      undefined,
      vi.fn(),
      onRetryOffice
    )

    const retry = container.querySelector<HTMLButtonElement>('[data-testid="wt-retry-office"]')
    expect(retry?.textContent).toContain('Réessayer maintenant')
    act(() => retry!.click())
    expect(onRetryOffice).toHaveBeenCalledWith('a1')
  })
})
