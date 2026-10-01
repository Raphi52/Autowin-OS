// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RELIRE_PENDANT_TOUR_MS, SourceControlPane } from './SourceControlPane'
import type { GitReadResult } from '../../../shared/git-read'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const GIT: GitReadResult = {
  available: true,
  state: {
    branch: 'feat/source-control',
    ahead: 1,
    behind: 0,
    changes: [
      {
        path: 'src/main/index.ts',
        status: 'modified',
        staged: false,
        workspaceRoot: 'C:/repo'
      },
      {
        path: 'src/shared/git-read.ts',
        status: 'added',
        staged: true,
        workspaceRoot: 'C:/repo'
      }
    ]
  },
  history: [{ hash: 'a1b2c3d', subject: 'feat: git-read' }]
}

const calls: {
  repoArgs: (string | undefined)[]
  conversationArgs: string[]
  conversationDiffArgs: Array<[string, string, string]>
  brainArgs: string[]
  pickReturns: (string | null)[]
} = {
  repoArgs: [],
  conversationArgs: [],
  conversationDiffArgs: [],
  brainArgs: [],
  pickReturns: []
}
function mockApi(
  git: GitReadResult,
  diff = 'diff --git a/x b/x\n@@ -1 +1 @@\n-old\n+new',
  brainTraces: unknown[] = []
): void {
  calls.repoArgs = []
  calls.conversationArgs = []
  calls.conversationDiffArgs = []
  calls.brainArgs = []
  ;(window as unknown as { api: unknown }).api = {
    getGitState: (repoPath?: string) => {
      calls.repoArgs.push(repoPath)
      return Promise.resolve(git)
    },
    conversationGitState: (conversationId: string) => {
      calls.conversationArgs.push(conversationId)
      return Promise.resolve(git)
    },
    conversationGitDiff: (conversationId: string, path: string, workspaceRoot: string) => {
      calls.conversationDiffArgs.push([conversationId, path, workspaceRoot])
      return Promise.resolve({ available: true, diff })
    },
    brainTraces: (conversationId: string) => {
      calls.brainArgs.push(conversationId)
      return Promise.resolve(brainTraces)
    },
    getGitDiff: () => Promise.resolve({ available: true, diff }),
    pickGitRepo: () => Promise.resolve(calls.pickReturns.shift() ?? null),
    getWorktreeActivity: () => Promise.resolve([]),
    onWorktreeActivity: () => () => {},
    onPilotEvent: () => () => {},
    onAppEvent: () => () => {},
    retryWorktreeRecovery: () => Promise.resolve(undefined),
    listProjectDir: () =>
      Promise.resolve({ ok: true, entries: [{ name: 'README.md', path: 'README.md', dir: false }] }),
    readProjectFile: () => Promise.resolve({ ok: true, content: '# titre' }),
    writeProjectFile: () => Promise.resolve({ ok: true })
  }
}

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
  localStorage.clear()
})
async function render(
  onSendPrompt?: (p: string) => void,
  conversationId = 'conv-a'
): Promise<void> {
  await act(async () => {
    root.render(createElement(SourceControlPane, { onSendPrompt, conversationId }))
    await Promise.resolve()
    await Promise.resolve()
  })
}
describe('SourceControlPane (prompt-first)', () => {
  /** Bascule sur la vue « Workspace » (branche et copies d'agents). */
  async function openWorkspaceView(): Promise<void> {
    const tab = container.querySelector('[data-testid="sc-view-workspace"]') as HTMLButtonElement
    await act(async () => {
      tab.click()
      await Promise.resolve()
    })
  }

  /**
   * SOUS-ONGLET « PROJET ». Demande de l'utilisateur le 2026-09-12 : l'arborescence editable doit
   * etre une vue du panneau, au MEME rang que Fichiers / Brain / Workspace — et non un bloc
   * empile au-dessus d'eux dans l'onglet Files.
   */
  it('vue Projet : quatrieme sous-onglet, monte l’arborescence editable', async () => {
    mockApi(GIT)
    await render()
    const onglets = Array.from(container.querySelectorAll('.sc-repo-btn')).map((b) =>
      b.textContent?.trim().replace(/\d+$/, '')
    )
    expect(onglets).toEqual(['Fichiers', 'Projet', 'Brain', 'Git'])
    expect(container.querySelector('[data-testid="project-pane"]')).toBeNull()

    const tab = container.querySelector('[data-testid="sc-view-tree"]') as HTMLButtonElement
    await act(async () => {
      tab.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.querySelector('[data-testid="project-pane"]')).not.toBeNull()
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(0)
  })

  it('relit les fichiers modifies a la FIN d’un tour du chat (sans quitter l’onglet)', async () => {
    mockApi(GIT)
    let emettre: ((e: unknown) => void) | null = null
    ;(window as unknown as { api: { onPilotEvent: unknown } }).api.onPilotEvent = (
      cb: (e: unknown) => void
    ) => {
      emettre = cb
      return () => {}
    }
    await render()
    expect(calls.conversationArgs).toEqual(['conv-a'])
    await act(async () => {
      emettre?.({ conversationId: 'conv-a', kind: 'done' })
      await Promise.resolve()
    })
    expect(calls.conversationArgs).toEqual(['conv-a', 'conv-a'])
  })

  it('relit PENDANT le tour quand l’agent passe par son terminal (commit sans result ni done)', async () => {
    vi.useFakeTimers()
    try {
      mockApi(GIT)
      let emettre: ((e: unknown) => void) | null = null
      ;(window as unknown as { api: { onPilotEvent: unknown } }).api.onPilotEvent = (
        cb: (e: unknown) => void
      ) => {
        emettre = cb
        return () => {}
      }
      await render()
      expect(calls.conversationArgs).toEqual(['conv-a'])
      await act(async () => {
        emettre?.({ conversationId: 'conv-a', kind: 'provider-status', text: 'Bash' })
        emettre?.({ conversationId: 'conv-a', kind: 'delta', text: 'commit fait' })
        emettre?.({ conversationId: 'conv-b', kind: 'provider-status', text: 'Bash' })
        await Promise.resolve()
      })
      expect(calls.conversationArgs).toEqual(['conv-a'])
      await act(async () => {
        vi.advanceTimersByTime(RELIRE_PENDANT_TOUR_MS)
        await Promise.resolve()
      })
      // Une seule relecture pour la rafale, aucune pour l'autre conversation.
      expect(calls.conversationArgs).toEqual(['conv-a', 'conv-a'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('vue par défaut : UNIQUEMENT les changements (ni branche ni historique)', async () => {
    mockApi(GIT)
    await render()
    expect(calls.conversationArgs).toEqual(['conv-a'])
    expect(calls.repoArgs).toHaveLength(0)
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(2)
    // La branche vit derrière « Workspace » ; l'historique appartient à la vue Worktrees.
    expect(container.textContent).not.toContain('feat/source-control')
    expect(container.textContent).not.toContain('a1b2c3d')
  })

  it('vue Workspace : branche et copies d’agents, sans historique ni liste des changements', async () => {
    mockApi(GIT)
    await render()
    const tab = container.querySelector('[data-testid="sc-view-workspace"]')
    expect(tab?.textContent?.trim()).toBe('Git')
    await openWorkspaceView()
    expect(container.textContent).toContain('feat/source-control')
    // Le Hub des bureaux a quitté ce panneau : il vit dans l'onglet plein écran Worktrees.
    expect(container.textContent).not.toContain('Hub des bureaux')
    expect(container.querySelector('[data-testid="wt-view"]')).toBeNull()
    expect(container.textContent).not.toContain('a1b2c3d')
    expect(container.textContent).not.toContain('Historique')
    expect(container.querySelectorAll('[data-testid="sc-file"]')).toHaveLength(0)
  })

  it('rétablit et explique l’état Auto-close quand sa persistance échoue', async () => {
    mockApi(GIT)
    const setAutoClose = vi.fn(() => Promise.reject(new Error('disque indisponible')))
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getAutoClose = () => Promise.resolve({ enabled: false })
    api.setAutoClose = setAutoClose
    await render()
    await openWorkspaceView()

    const toggle = container.querySelector('[data-testid="sc-autoclose"]') as HTMLButtonElement
    await act(async () => {
      toggle.click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(setAutoClose).toHaveBeenCalledWith(true)
    expect(toggle.getAttribute('aria-pressed')).toBe('false')
    expect(toggle.textContent).toContain('OFF')
    expect(container.querySelector('[data-testid="sc-autoclose-error"]')?.textContent).toContain(
      'Impossible de conserver ce réglage'
    )
  })

  it('affiche le dernier résultat réel de clôture au lieu de promettre un push absolu', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getAutoClose = () =>
      Promise.resolve({
        enabled: true,
        last: {
          runId: 'run-42',
          branch: 'auto/run-42',
          at: '2026-08-10T12:00:00.000Z',
          project: { status: 'skipped', reason: 'no-remote' },
          brain: { status: 'skipped', reason: 'no-changes' }
        }
      })
    await render()
    await openWorkspaceView()

    const toggle = container.querySelector('[data-testid="sc-autoclose"]') as HTMLButtonElement
    expect(toggle.title).toContain('tente de publier')
    expect(container.querySelector('[data-testid="sc-autoclose-last"]')?.textContent).toContain(
      'Projet · non publié · aucun distant'
    )
  })

  it('un enchaînement de CHAT dit ce qui est parti et nomme ce qui reste en attente', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getAutoClose = () =>
      Promise.resolve({
        enabled: true,
        last: {
          runId: 'conv-871 · tour a87271b1',
          branch: 'auto/conv-871-a87271b1',
          at: '2026-09-26T12:00:00.000Z',
          source: 'chat',
          project: { status: 'pushed', branch: 'main', files: 2, mode: 'direct' },
          exclus: [
            { path: 'src/partage.ts', motif: 'touche-par-un-autre-fil' },
            // Mesuré le 2026-09-29 : un fichier écarté pour 2 lignes sur 146, sans que rien le dise.
            { path: 'src/b.ts', motif: 'modifie-avant-le-tour', lignesNonReclamees: 2 },
            { path: 'src/c.ts', motif: 'modifie-avant-le-tour', lignesNonReclamees: 1 }
          ]
        }
      })
    await render()
    await openWorkspaceView()

    const last = container.querySelector('[data-testid="sc-autoclose-last"]')?.textContent ?? ''
    expect(last).toContain('Projet · poussé sur main')
    // Un tour de chat ne publie jamais le Brain : aucune ligne ne doit le laisser croire.
    expect(last).not.toContain('Brain')
    expect(container.querySelector('[data-testid="sc-autoclose-exclus"]')?.textContent).toBe(
      'Laissé en attente · src/partage.ts (touché aussi par un autre fil), ' +
        'src/b.ts (déjà modifié avant le tour, 2 lignes non réclamées), ' +
        'src/c.ts (déjà modifié avant le tour, 1 ligne non réclamée)'
    )
    const toggle = container.querySelector('[data-testid="sc-autoclose"]') as HTMLButtonElement
    expect(toggle.title).toContain('chaque tour de chat')
  })

  it('un tour bloqué par des tests ROUGES dit lesquels, et rien n’est annoncé comme poussé', async () => {
    // Mesuré le 2026-10-01 : `b6d2a3fc` a été poussé sans test et a laissé main rouge 20 h. Les tests
    // sont désormais rejoués avant de pousser ; le panneau doit dire pourquoi rien n'est parti.
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.getAutoClose = () =>
      Promise.resolve({
        enabled: true,
        last: {
          runId: 'conv-892 · tour b6d2a3fc',
          branch: 'auto/conv-892-b6d2a3fc',
          at: '2026-10-01T12:00:00.000Z',
          source: 'chat',
          project: { status: 'skipped', reason: 'tests-rouges', detail: '2 test(s) en échec' },
          exclus: [
            {
              path: 'src/main/index.ts',
              motif: 'tests-rouges',
              testsEnEchec: ['src/main/chat-ipc-contract.test.ts']
            }
          ],
          verification: {
            statut: 'echec',
            commande: 'vitest related src/main/index.ts --run',
            detail: '2 test(s) en échec',
            testsEnEchec: ['src/main/chat-ipc-contract.test.ts']
          }
        }
      })
    await render()
    await openWorkspaceView()

    const last = container.querySelector('[data-testid="sc-autoclose-last"]')?.textContent ?? ''
    expect(last).toContain('Projet · non publié · tests rouges')
    expect(last).not.toContain('poussé')
    expect(container.querySelector('[data-testid="sc-autoclose-exclus"]')?.textContent).toBe(
      'Laissé en attente · src/main/index.ts (tests rouges : src/main/chat-ipc-contract.test.ts)'
    )
    expect(container.querySelector('[data-testid="sc-autoclose-verification"]')?.textContent).toBe(
      'Tests rejoués avant de pousser · 2 test(s) en échec'
    )
  })

  it('un tour publié dit combien de tests ont été rejoués, ou pourquoi aucun ne l’a été', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    let verification: Record<string, unknown> = {
      statut: 'vert',
      commande: 'vitest related src/a.ts --run',
      testsJoues: 12
    }
    api.getAutoClose = () =>
      Promise.resolve({
        enabled: true,
        last: {
          runId: 'conv-1 · tour aaaaaaaa',
          branch: 'auto/conv-1-aaaaaaaa',
          at: '2026-10-01T12:00:00.000Z',
          source: 'chat',
          project: { status: 'pushed', branch: 'main', files: 1, mode: 'direct' },
          verification
        }
      })
    await render()
    await openWorkspaceView()
    expect(container.querySelector('[data-testid="sc-autoclose-verification"]')?.textContent).toBe(
      'Tests rejoués avant de pousser · 12 verts'
    )

    // Second rendu, sur une racine neuve (même préparation que le `beforeEach`).
    act(() => root.unmount())
    container.remove()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    verification = { statut: 'non-verifie', raison: 'aucun test ciblable pour notes.md' }
    await render()
    await openWorkspaceView()
    expect(container.querySelector('[data-testid="sc-autoclose-verification"]')?.textContent).toBe(
      'Tests non rejoués · aucun test ciblable pour notes.md'
    )
  })

  it('rafraichit le resultat auto-close quand une publication differee se termine', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    let published = false
    let notifyWorktree!: (activity: unknown[]) => void
    const getAutoClose = vi.fn(() =>
      Promise.resolve(
        published
          ? {
              enabled: true,
              last: {
                runId: 'run-delayed',
                branch: 'auto/run-delayed',
                at: '2026-08-10T12:00:00.000Z',
                project: { status: 'pushed', branch: 'auto/run-delayed', files: 1 },
                brain: { status: 'skipped', reason: 'no-changes' }
              }
            }
          : { enabled: true }
      )
    )
    api.getAutoClose = getAutoClose
    api.onWorktreeActivity = (listener: (activity: unknown[]) => void) => {
      notifyWorktree = listener
      return () => {}
    }
    await render()
    await openWorkspaceView()
    expect(container.querySelector('[data-testid="sc-autoclose-last"]')).toBeNull()

    published = true
    await act(async () => {
      notifyWorktree([])
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(getAutoClose).toHaveBeenCalledTimes(2)
    expect(container.querySelector('[data-testid="sc-autoclose-last"]')?.textContent).toContain(
      'Projet · publié · auto/run-delayed'
    )
  })

  it('clic sur un fichier affiche son diff (consultation read-only)', async () => {
    mockApi(GIT)
    await render()
    const file = container.querySelector('[data-testid="sc-file"]') as HTMLDivElement
    await act(async () => {
      file.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(calls.conversationDiffArgs).toEqual([['conv-a', 'src/main/index.ts', 'C:/repo']])
    expect(container.querySelector('[data-testid="diff-view"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="sc-diff-card"]')).not.toBeNull()
    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/main/index.ts')
    expect(container.querySelector('.sc-diff-wrap-mode')?.textContent).toContain('Retour ligne')
    expect(container.textContent).toContain('+new')
  })

  it('sort du chargement et affiche une erreur quand la lecture du diff échoue', async () => {
    mockApi(GIT)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.conversationGitDiff = () => Promise.reject(new Error('git indisponible'))
    await render()

    await act(async () => {
      ;(container.querySelector('[data-testid="sc-file"]') as HTMLDivElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Diff indisponible.')
    expect(container.textContent).not.toContain('Chargement du diff')
  })

  it('ignore un diff obsolète si un autre fichier est ouvert entre-temps', async () => {
    mockApi(GIT)
    let resolveFirst!: (value: { available: true; diff: string }) => void
    let resolveSecond!: (value: { available: true; diff: string }) => void
    const first = new Promise<{ available: true; diff: string }>((resolve) => {
      resolveFirst = resolve
    })
    const second = new Promise<{ available: true; diff: string }>((resolve) => {
      resolveSecond = resolve
    })
    ;(
      window as unknown as {
        api: {
          conversationGitDiff: (
            conversationId: string,
            path: string,
            workspaceRoot: string
          ) => Promise<{ available: true; diff: string }>
        }
      }
    ).api.conversationGitDiff = (_conversationId, path) =>
      path === 'src/main/index.ts' ? first : second

    await render()
    const files = container.querySelectorAll('[data-testid="sc-file"]')
    act(() => {
      ;(files[0] as HTMLDivElement).click()
      ;(files[1] as HTMLDivElement).click()
    })
    await act(async () => {
      resolveSecond({ available: true, diff: '@@ -1 +1 @@\n-old-second\n+new-second' })
      await second
    })
    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/shared/git-read.ts')
    expect(container.textContent).toContain('+new-second')

    await act(async () => {
      resolveFirst({ available: true, diff: '@@ -1 +1 @@\n-old-first\n+new-first' })
      await first
    })
    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/shared/git-read.ts')
    expect(container.textContent).toContain('+new-second')
    expect(container.textContent).not.toContain('+new-first')
  })

  it('ignore aussi l’erreur obsolète d’un premier diff après le succès du second', async () => {
    mockApi(GIT)
    let rejectFirst!: (reason: Error) => void
    let resolveSecond!: (value: { available: true; diff: string }) => void
    const first = new Promise<{ available: true; diff: string }>((_resolve, reject) => {
      rejectFirst = reject
    })
    const second = new Promise<{ available: true; diff: string }>((resolve) => {
      resolveSecond = resolve
    })
    ;(
      window as unknown as {
        api: {
          conversationGitDiff: (
            conversationId: string,
            path: string,
            workspaceRoot: string
          ) => Promise<{ available: true; diff: string }>
        }
      }
    ).api.conversationGitDiff = (_conversationId, path) =>
      path === 'src/main/index.ts' ? first : second

    await render()
    const files = container.querySelectorAll('[data-testid="sc-file"]')
    act(() => {
      ;(files[0] as HTMLDivElement).click()
      ;(files[1] as HTMLDivElement).click()
    })
    await act(async () => {
      resolveSecond({ available: true, diff: '@@ -1 +1 @@\n-old-second\n+new-second' })
      await second
    })
    await act(async () => {
      rejectFirst(new Error('premier diff indisponible'))
      await Promise.resolve()
    })

    expect(container.querySelector('.sc-diff-title')?.textContent).toBe('src/shared/git-read.ts')
    expect(container.textContent).toContain('+new-second')
    expect(container.textContent).not.toContain('Diff indisponible.')
  })

  it('un bouton envoie la demande à l’agent (le renderer n’exécute aucun git)', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    const commit = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Commit')
    ) as HTMLButtonElement
    act(() => commit.click())
    // La barre de prompt intermédiaire a été retirée : le clic transmet directement à l'agent,
    // qui reste le SEUL à exécuter git (le renderer ne fait que de la lecture).
    expect(onSendPrompt).toHaveBeenCalledTimes(1)
    expect(String(onSendPrompt.mock.calls[0][0])).toContain('commit')
    expect(container.querySelector('[data-testid="sc-prompt-input"]')).toBeNull()
  })

  it('« Annuler ces changements » demande une CONFIRMATION avant d’envoyer la demande', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-file"]') as HTMLDivElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    const bouton = (): HTMLButtonElement =>
      container.querySelector('[data-testid="sc-diff-annuler"]') as HTMLButtonElement
    expect(bouton().textContent).toBe('Annuler ces changements')
    act(() => bouton().click())
    // Premier clic : rien ne part, le bouton demande confirmation.
    expect(onSendPrompt).not.toHaveBeenCalled()
    expect(bouton().textContent).toContain('Confirmer')
    act(() => bouton().click())
    expect(onSendPrompt).toHaveBeenCalledTimes(1)
    expect(String(onSendPrompt.mock.calls[0][0])).toMatch(/^annule les changements de /)
    expect(bouton().textContent).toBe('Annuler ces changements')
    // Une fois annule, le fichier propose de REMETTRE ses changements.
    const remettre = container.querySelector('[data-testid="sc-remettre"]') as HTMLButtonElement
    expect(remettre.textContent).toBe('Remettre le changement')
    act(() => remettre.click())
    expect(String(onSendPrompt.mock.calls[1][0])).toMatch(/^remets les changements de /)
    expect(container.querySelector('[data-testid="sc-remettre"]')).toBeNull()
  })

  it('vue Workspace : lit le dépôt de la CONVERSATION, pas le dépôt mémorisé', async () => {
    // 2026-09-23 : le panneau annonçait « RIG-V3 » et sa branche sur une conversation ouverte sur
    // AutoWinOS — le chemin mémorisé une fois dans le navigateur primait sur le fil.
    localStorage.setItem('autowin:sc-repo', 'C:/rig-v3')
    mockApi(GIT)
    await act(async () => {
      root.render(
        createElement(SourceControlPane, {
          conversationId: 'conv-a',
          depotConversation: 'C:/Sources/AutoWinOS'
        })
      )
      await Promise.resolve()
      await Promise.resolve()
    })
    await openWorkspaceView()
    expect(calls.repoArgs).toContain('C:/Sources/AutoWinOS')
    expect(calls.repoArgs).not.toContain('C:/rig-v3')
    expect(container.textContent).toContain('AutoWinOS')
  })

  it('le dépôt Worktree persisté ne change jamais le dépôt du Projet', async () => {
    localStorage.setItem('autowin:sc-repo', 'C:/rig')
    mockApi(GIT)
    await render()
    expect(calls.conversationArgs).toEqual(['conv-a'])
    expect(calls.repoArgs).toHaveLength(0)
    await openWorkspaceView()
    expect(calls.repoArgs).toContain('C:/rig')
  })

  it('Brain affiche uniquement les appels de la conversation, pas le dépôt Brain', async () => {
    mockApi(GIT, undefined, [
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        turnId: 'turn-a',
        kind: 'query',
        query: 'décision architecture',
        found: true,
        injectedChars: 420
      }
    ])
    await render()
    const brain = container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement
    expect(brain).not.toBeNull()
    await act(async () => {
      brain.click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(calls.brainArgs).toContain('conv-a')
    expect(calls.repoArgs.some((p) => String(p).includes('Amitel Brain'))).toBe(false)
    expect(container.textContent).toContain('décision architecture')
    expect(container.textContent).toContain('420')
    expect(container.textContent).toContain('Tour turn-a')
  })

  it('distingue une lecture Brain indisponible d’une conversation sans appel', async () => {
    mockApi(GIT)
    ;(
      window as unknown as {
        api: { brainTraces: (conversationId: string) => Promise<unknown[]> }
      }
    ).api.brainTraces = () => Promise.reject(new Error('spool illisible'))

    await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Lecture des appels Brain indisponible.')
    expect(container.textContent).not.toContain('Aucun appel Brain dans cette conversation.')
  })

  it('signale explicitement un résultat Brain historique sans statut', async () => {
    mockApi(GIT, undefined, [
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        kind: 'query',
        query: 'ancienne recherche',
        injectedChars: 12
      }
    ])

    await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Résultat historique inconnu')
  })

  it('distingue un service Brain indisponible d’une recherche vide', async () => {
    mockApi(GIT, undefined, [
      {
        timestamp: '2026-07-30T20:00:00.000Z',
        conversationId: 'conv-a',
        kind: 'automatic',
        query: 'contexte demandé',
        found: false,
        status: 'unavailable',
        injectedChars: 0
      }
    ])

    await render()
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.textContent).toContain('Brain indisponible')
    expect(container.textContent).not.toContain('Aucun résultat')
  })

  it('ignore la réponse Projet obsolète après un changement de conversation', async () => {
    mockApi(GIT)
    let resolveA!: (value: GitReadResult) => void
    const slowA = new Promise<GitReadResult>((resolve) => {
      resolveA = resolve
    })
    const gitB: GitReadResult = {
      available: true,
      state: {
        branch: 'main',
        ahead: 0,
        behind: 0,
        changes: [{ path: 'conversation-b.ts', status: 'modified', staged: false }]
      }
    }
    ;(
      window as unknown as {
        api: {
          conversationGitState: (
            conversationId: string,
            repoPath?: string
          ) => Promise<GitReadResult>
        }
      }
    ).api.conversationGitState = (conversationId) =>
      conversationId === 'conv-a' ? slowA : Promise.resolve(gitB)

    await act(async () => {
      root.render(createElement(SourceControlPane, { conversationId: 'conv-a' }))
      await Promise.resolve()
      root.render(createElement(SourceControlPane, { conversationId: 'conv-b' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('conversation-b.ts')

    await act(async () => {
      resolveA(GIT)
      await slowA
    })
    expect(container.textContent).toContain('conversation-b.ts')
    expect(container.textContent).not.toContain('src/main/index.ts')
  })

  it('efface Brain immédiatement puis charge la nouvelle conversation sans fuite', async () => {
    mockApi(GIT)
    let resolveB!: (value: unknown[]) => void
    const slowB = new Promise<unknown[]>((resolve) => {
      resolveB = resolve
    })
    const traceA = {
      timestamp: '2026-07-30T20:00:00.000Z',
      conversationId: 'conv-a',
      kind: 'query',
      query: 'brain-a',
      injectedChars: 99
    }
    ;(
      window as unknown as {
        api: { brainTraces: (conversationId: string) => Promise<unknown[]> }
      }
    ).api.brainTraces = (conversationId) =>
      conversationId === 'conv-a' ? Promise.resolve([traceA]) : slowB

    await render(undefined, 'conv-a')
    await act(async () => {
      ;(container.querySelector('[data-testid="sc-repo-brain"]') as HTMLButtonElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('brain-a')

    await act(async () => {
      root.render(createElement(SourceControlPane, { conversationId: 'conv-b' }))
      await Promise.resolve()
    })
    expect(container.textContent).not.toContain('brain-a')

    await act(async () => {
      resolveB([
        {
          timestamp: '2026-07-30T20:05:00.000Z',
          conversationId: 'conv-b',
          kind: 'query',
          query: 'brain-b',
          found: true,
          injectedChars: 12
        }
      ])
      await slowB
    })
    expect(container.textContent).toContain('brain-b')
    expect(container.textContent).not.toContain('brain-a')
  })

  it('le bouton Push (vue Workspace) transmet directement la demande à l’agent', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    await openWorkspaceView()
    const push = [...container.querySelectorAll('button')].find((b) =>
      b.textContent?.includes('Push')
    ) as HTMLButtonElement
    act(() => push.click())
    expect(onSendPrompt).toHaveBeenCalledWith('push la branche courante')
  })

  it('onglet Git : seules les actions non couvertes par les étapes restent', async () => {
    mockApi(GIT)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    await openWorkspaceView()
    const actions = [...(container.querySelector('[data-testid="sc-git-actions"]')?.querySelectorAll('button') ?? [])]
    expect(actions.map((b) => b.textContent)).toEqual(['Nouvelle branche', 'Changer de branche', 'Mettre de côté'])
    act(() => (actions[2] as HTMLButtonElement).click())
    expect(onSendPrompt).toHaveBeenCalledWith('mets de côté mes changements en cours (stash nommé) sans rien perdre')
  })

  it('onglet Git : les étapes suivent l’état réel du dépôt', async () => {
    mockApi(GIT)
    await render()
    await openWorkspaceView()
    const etapes = [...container.querySelectorAll('[data-testid="sc-git-flux"] button')]
    expect(etapes.map((b) => b.querySelector('b')?.textContent?.trim())).toEqual([
      '1 Commiter',
      '2 Push',
      '3 Ouvrir une PR'
    ])
    expect(etapes[0].className).toContain('is-suggested')
    expect(etapes[1].querySelector('.sc-flux-detail')?.textContent).toBe('1 commit à envoyer')
    expect(container.querySelector('[data-testid="sc-autoclose"]')).not.toBeNull()
  })
})

describe('etapesGit', () => {
  it('main en retard et en avance : récupérer puis push, jamais de PR', async () => {
    const { etapesGit } = await import('./etapes-git')
    expect(etapesGit({ branch: 'main', ahead: 5, behind: 2, changes: [] }).map((e) => e.label)).toEqual([
      'Récupérer',
      'Push'
    ])
  })
  it('main propre et synchronisé : aucune étape', async () => {
    const { etapesGit } = await import('./etapes-git')
    expect(etapesGit({ branch: 'main', ahead: 0, behind: 0, changes: [] })).toEqual([])
  })
})

describe('SourceControlPane — relecture ligne à ligne envoyée à l’agent', () => {
  const DIFF_REL = 'diff --git a/x b/x\n@@ -5,2 +5,2 @@\n garde()\n-ancien()\n+nouveau()'
  const par = (id: string): HTMLElement | null =>
    container.querySelector(`[data-testid="${id}"]`) as HTMLElement | null

  async function ouvrirPremierDiff(): Promise<void> {
    await act(async () => {
      ;(par('sc-file') as HTMLDivElement).click()
      await Promise.resolve()
      await Promise.resolve()
    })
  }
  function commenterDerniereLigne(texte: string): void {
    const boutons = container.querySelectorAll<HTMLButtonElement>('[data-testid="diff-commenter"]')
    act(() => boutons[boutons.length - 1].click())
    const zone = par('diff-editeur-texte') as HTMLTextAreaElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        zone,
        texte
      )
      zone.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => (par('diff-editeur-ajouter') as HTMLButtonElement).click())
  }

  it('un commentaire posé apparaît dans la barre ; « Envoyer » part en UN message fichier:ligne + texte cité', async () => {
    mockApi(GIT, DIFF_REL)
    const onSendPrompt = vi.fn()
    await render(onSendPrompt)
    expect(par('sc-relecture')).toBeNull()
    await ouvrirPremierDiff()
    commenterDerniereLigne('renomme en nouveauNom()')
    expect(par('sc-relecture')?.textContent).toContain('1 commentaire sur 1 fichier')
    expect(par('diff-comment')?.textContent).toContain('renomme en nouveauNom()')
    expect(onSendPrompt).not.toHaveBeenCalled()
    act(() => (par('sc-relecture-envoyer') as HTMLButtonElement).click())
    expect(onSendPrompt).toHaveBeenCalledTimes(1)
    const message = String(onSendPrompt.mock.calls[0][0])
    expect(message).toContain('1. src/main/index.ts:6\n')
    expect(message).toContain('+nouveau()    ⟵ ici')
    expect(message).toContain('Commentaire : renomme en nouveauNom()')
    // Le lot envoyé quitte le brouillon, mais reste récupérable si l'agent n'a rien reçu.
    expect(par('sc-relecture')).toBeNull()
    act(() => (par('sc-relecture-remettre') as HTMLButtonElement).click())
    expect(par('sc-relecture')?.textContent).toContain('1 commentaire')
  })

  it('la relecture survit au démontage du panneau (changement d’onglet) et reste propre à SA conversation', async () => {
    mockApi(GIT, DIFF_REL)
    await render(vi.fn(), 'conv-a')
    await ouvrirPremierDiff()
    commenterDerniereLigne('à revoir')
    act(() => root.unmount())
    root = createRoot(container)
    await render(vi.fn(), 'conv-a')
    expect(par('sc-relecture')?.textContent).toContain('1 commentaire')
    await render(vi.fn(), 'conv-b')
    expect(par('sc-relecture')).toBeNull()
  })

  it('« Tout effacer » demande un second clic avant de perdre les commentaires', async () => {
    mockApi(GIT, DIFF_REL)
    await render(vi.fn())
    await ouvrirPremierDiff()
    commenterDerniereLigne('x')
    const effacer = (): HTMLButtonElement => par('sc-relecture-effacer') as HTMLButtonElement
    act(() => effacer().click())
    expect(par('sc-relecture')).not.toBeNull()
    expect(effacer().textContent).toContain('Confirmer')
    act(() => effacer().click())
    expect(par('sc-relecture')).toBeNull()
  })

  /** Branche l'écoute des événements du tour et rend de quoi en émettre un. */
  function brancherEvenements(): { emettre: (e: unknown) => Promise<void> } {
    let recu: ((e: unknown) => void) | null = null
    ;(window as unknown as { api: { onPilotEvent: unknown } }).api.onPilotEvent = (
      cb: (e: unknown) => void
    ) => {
      recu = cb
      return () => {}
    }
    return {
      emettre: async (e) => {
        await act(async () => {
          recu?.(e)
          for (let i = 0; i < 4; i++) await Promise.resolve()
        })
      }
    }
  }

  it('une relecture PENDANT le tour garde le diff ouvert, le met à jour et garde le commentaire en cours', async () => {
    mockApi(GIT, DIFF_REL)
    const { emettre } = brancherEvenements()
    await render(vi.fn())
    await ouvrirPremierDiff()
    const boutons = container.querySelectorAll<HTMLButtonElement>('[data-testid="diff-commenter"]')
    act(() => boutons[boutons.length - 1].click())
    const zone = par('diff-editeur-texte') as HTMLTextAreaElement
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(
        zone,
        'brouillon en cours'
      )
      zone.dispatchEvent(new Event('input', { bubbles: true }))
    })
    // L'agent retouche le fichier : le diff relu porte une ligne de plus.
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.conversationGitDiff = (conversationId: string, path: string, workspaceRoot: string) => {
      calls.conversationDiffArgs.push([conversationId, path, workspaceRoot])
      return Promise.resolve({
        available: true,
        diff: 'diff --git a/x b/x\n@@ -5,2 +5,3 @@\n garde()\n-ancien()\n+nouveau()\n+encore()'
      })
    }
    await emettre({ conversationId: 'conv-a', kind: 'done' })
    expect(calls.conversationArgs).toEqual(['conv-a', 'conv-a'])
    expect(par('diff-view')).not.toBeNull()
    expect(par('diff-view')?.textContent).toContain('+encore()')
    expect(calls.conversationDiffArgs).toHaveLength(2)
    expect((par('diff-editeur-texte') as HTMLTextAreaElement | null)?.value).toBe(
      'brouillon en cours'
    )
  })

  it('un fichier qui SORT de la liste à la relecture referme son diff', async () => {
    mockApi(GIT, DIFF_REL)
    const { emettre } = brancherEvenements()
    await render(vi.fn())
    await ouvrirPremierDiff()
    expect(par('diff-view')).not.toBeNull()
    const api = (window as unknown as { api: Record<string, unknown> }).api
    api.conversationGitState = () =>
      Promise.resolve({ ...GIT, state: { ...GIT.state!, changes: GIT.state!.changes.slice(1) } })
    await emettre({ conversationId: 'conv-a', kind: 'done' })
    expect(par('diff-view')).toBeNull()
  })

  it('le bouton « Lancer » est monté dans la vue Fichiers, et seulement là', async () => {
    mockApi(GIT, DIFF_REL)
    const api = (window as unknown as { api: Record<string, unknown> }).api
    const etats: string[] = []
    api.lancementEtat = (id: string) => {
      etats.push(id)
      return Promise.resolve({
        statut: 'arrete',
        lignes: [],
        commande: 'npm run dev',
        source: 'autowin'
      })
    }
    api.onLancement = () => () => {}
    await render(vi.fn(), 'conv-lance')
    await act(async () => {
      await Promise.resolve()
    })
    expect(etats).toEqual(['conv-lance'])
    expect(par('sc-lancement-commande')?.textContent).toBe('npm run dev')
    await act(async () => {
      ;(par('sc-view-workspace') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(par('sc-lancement')).toBeNull()
  })

  it('sans canal vers l’agent, le diff reste en lecture seule', async () => {
    mockApi(GIT, DIFF_REL)
    await render(undefined)
    await ouvrirPremierDiff()
    expect(par('diff-view')).not.toBeNull()
    expect(par('diff-commenter')).toBeNull()
  })
})
