// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import type { BureauGere } from '../../../shared/hdesk-gestion'
import { appliquerLangue } from '../langue'
import { WorktreeView } from './WorktreeView'
import { HdeskGestionView, type HdeskGestionApi } from './HdeskGestionView'

/**
 * LES ÉCRANS WORKTREES ET BUREAUX CACHÉS SUIVENT LA LANGUE (traduction anglaise, conv-1170, lot 12).
 * Entrée qui doit faire échouer ce test : un libellé de ces deux écrans laissé en dur en français,
 * une date de commit restée au format français, ou un écran qui ne se redessine pas quand la langue
 * change (le retour au français est vérifié sur le MÊME rendu, sans remonter le composant).
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const SNAPSHOT = {
  available: true as const,
  repoPath: 'C:\\Travail\\Autowin OS',
  repositoryName: 'Autowin OS',
  head: '46285c3',
  branch: 'main',
  changeCount: 2,
  refs: [
    {
      name: 'main',
      fullName: 'refs/heads/main',
      kind: 'local' as const,
      hash: '46285c3full',
      isHead: true
    }
  ],
  worktrees: [],
  commits: [
    {
      hash: '46285c3full',
      shortHash: '46285c3',
      parents: [],
      refs: ['HEAD -> main'],
      author: 'Raphaël',
      // Midi UTC le 15 : le même jour et le même mois dans tous les fuseaux d'Europe et d'Amérique.
      date: '2026-07-15T12:00:00.000Z',
      subject: 'merge: cockpit'
    }
  ]
}

const ACTIVITE: WorktreeAgentActivity[] = [
  {
    agentId: 'judge',
    agentName: 'Judge',
    role: 'judge',
    task: 'Trancher le conflit',
    baseBranch: 'feat/cockpit',
    state: 'conflict',
    verdict: 'red',
    publication: 'blocked',
    files: [{ path: 'src/shared/state.ts', kind: 'mod' }],
    conflictFile: 'src/shared/state.ts',
    startedAtMs: Date.now() - 120_000,
    endedAtMs: Date.now() - 60_000
  }
]

const BUREAU: BureauGere = {
  id: 'zox',
  travail: 'ZOX Rapture',
  relie: true,
  conversationId: 'conv-951',
  lanceLe: '2026-10-16T14:06:37+02:00',
  pid: 15432,
  executable: 'C:\\zox\\exe\\ZoxClientAccueil.exe'
}

const apiBureaux = (): HdeskGestionApi => ({
  hdeskGestionBureaux: vi.fn(async () => ({ ok: true as const, bureaux: [BUREAU] })),
  hdeskGestionFermer: vi.fn(async () => ({ ok: true, code: 0, message: 'ok' })),
  hdeskGestionCreer: vi.fn(async () => ({ ok: true as const, id: 'x', message: 'ok' })),
  hdeskTvImage: vi.fn(async (id: string) => ({
    statut: 'ok' as const,
    id,
    dataUrl: 'data:image/png;base64,AA',
    width: 1,
    height: 1
  })),
  hdeskTvAct: vi.fn(async () => ({ ok: true as const }))
})

let racine: Root | null = null
let hote: HTMLDivElement | null = null
let apiAvant: PropertyDescriptor | undefined

async function monter(element: React.ReactElement): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await act(async () => {
    racine!.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

afterEach(async () => {
  await act(async () => racine?.unmount())
  hote?.remove()
  racine = null
  hote = null
  if (apiAvant) Object.defineProperty(window, 'api', apiAvant)
  else Reflect.deleteProperty(window, 'api')
  apiAvant = undefined
  appliquerLangue('fr')
  vi.restoreAllMocks()
})

describe('Worktrees et Bureaux cachés — langue', () => {
  it('Worktrees bascule en anglais sans être remonté, puis revient au français', async () => {
    apiAvant = Object.getOwnPropertyDescriptor(window, 'api')
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getGitGraph: vi.fn(async () => SNAPSHOT),
        getWorktreeActivity: vi.fn(async () => ACTIVITE),
        onWorktreeActivity: vi.fn(() => () => {}),
        getTravauxNonPublies: vi.fn(async () => [])
      }
    })
    const vue = await monter(createElement(WorktreeView, { active: true }))
    const texte = (): string => vue.textContent ?? ''
    const date = (): string =>
      vue.querySelector('[data-testid="git-commit-date"]')?.textContent ?? ''
    // Le surtitre (« COCKPIT PROJET ») n'est pas vérifié : `ModuleHeader` ne le rend pas à l'écran.
    expect(texte()).toContain('Suis l’état, l’activité et les branches de ton dépôt.')
    expect(texte()).toContain('Santé du projet')
    expect(date()).toMatch(/juil\./)

    await act(async () => appliquerLangue('en'))
    expect(texte()).toContain('Follow the state, the activity and the branches of your repository.')
    expect(texte()).toContain('Project health')
    expect(texte()).toContain('Local changes')
    expect(texte()).toContain('Conflicts to decide · 1')
    expect(texte()).toContain('Kept desktops')
    expect(texte()).toContain('No desktop kept — nothing to sort.')
    expect(texte()).toContain('workstream is waiting for you')
    expect(vue.querySelector('.wt-cdp-pastille')?.textContent).toBe('up to you')
    expect(vue.querySelector('[data-testid="wt-keep-agent"]')?.textContent).toBe('Agent’s version')
    expect(vue.querySelector('[data-testid="git-topology-entete"]')?.textContent).toBe(
      'GraphDescriptionAuthorDate'
    )
    expect(date()).toMatch(/Jul/)
    expect(texte()).not.toContain('Santé du projet')

    await act(async () => appliquerLangue('fr'))
    expect(texte()).toContain('Santé du projet')
    expect(texte()).toContain('Conflits à trancher · 1')
    expect(vue.querySelector('.wt-cdp-pastille')?.textContent).toBe('à toi')
    expect(date()).toMatch(/juil\./)
  })

  it('Bureaux cachés bascule en anglais sans être remonté, puis revient au français', async () => {
    const vue = await monter(
      createElement(HdeskGestionView, {
        active: true,
        api: apiBureaux(),
        intervalleMs: 60_000,
        intervallePiloteMs: 1_500
      })
    )
    const texte = (): string => vue.textContent ?? ''
    expect(texte()).toContain('Bureaux cachés')
    expect(texte()).toContain('image toutes les 60 s')

    await act(async () => appliquerLangue('en'))
    expect(texte()).toContain('Hidden desktops')
    expect(texte()).toContain('+ New desktop')
    expect(vue.querySelector('[data-testid="hdesk-regarder"]')?.textContent).toBe('Watch')
    expect(vue.querySelector('[data-testid="hdesk-piloter"]')?.textContent).toBe('Drive')
    expect(texte()).toContain('read-only')
    expect(texte()).toContain('Show on my screen')
    expect(vue.querySelector('[data-testid="hdesk-direct"]')?.textContent).toBe('1 open')
    expect(vue.querySelector('[data-testid="hdesk-pied"]')?.textContent).toContain(
      'Thread conv-951'
    )
    expect(texte()).toContain('frame every 60 s')
    expect(
      vue.querySelector('[data-testid="hdesk-fermer-moniteur-zox"]')?.getAttribute('aria-label')
    ).toBe('Close desktop “ZOX Rapture”')

    // En Piloter, le bandeau garde son compte à rebours au milieu de la phrase traduite.
    await act(async () => {
      ;(vue.querySelector('[data-testid="hdesk-piloter"]') as HTMLButtonElement).click()
    })
    expect(vue.querySelector('[data-testid="hdesk-bandeau"]')?.textContent).toContain(
      'You are driving this desktop · back to Watch in 1:00 without a gesture'
    )

    await act(async () => appliquerLangue('fr'))
    expect(vue.querySelector('[data-testid="hdesk-bandeau"]')?.textContent).toContain(
      'Tu pilotes ce bureau · retour en Regarder dans 1:00 sans geste'
    )
    expect(vue.querySelector('[data-testid="hdesk-direct"]')?.textContent).toBe('1 ouvert')
    expect(texte()).toContain('image toutes les 1,5 s')
  })
})
