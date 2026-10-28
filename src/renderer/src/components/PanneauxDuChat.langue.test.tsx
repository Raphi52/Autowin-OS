// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { SourceControlPane } from './SourceControlPane'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import { appliquerLangue } from '../langue'
import type { GitReadResult } from '../../../shared/git-read'

/**
 * LES PANNEAUX DU CHAT SUIVENT LA LANGUE (traduction anglaise, conv-1170, lot 5). Entrée qui doit
 * faire échouer ce test : un libellé du contrôle de source ou de l'indicateur de quotas laissé en
 * dur, ou un panneau qui ne se redessine pas quand la langue change.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const GIT: GitReadResult = {
  available: true,
  state: {
    branch: 'feat/langue',
    ahead: 1,
    behind: 2,
    changes: [
      { path: 'src/a.ts', status: 'modified', staged: false, workspaceRoot: 'C:/repo' },
      { path: 'src/b.ts', status: 'added', staged: true, workspaceRoot: 'C:/repo' }
    ]
  },
  history: []
}

const QUOTAS = {
  observedAt: '2026-07-24T01:00:00.000Z',
  summary: { remainingPercent: 28, status: 'warning' },
  models: [
    {
      modelId: 'claude/opus',
      model: 'opus',
      label: 'Claude Opus',
      provider: 'claude',
      shared: true,
      status: 'stale',
      source: 'Claude /usage',
      observedAt: '2026-07-23T22:00:00.000Z',
      windows: [{ id: 'five-hour', label: '5 h', usedPercent: 72, remainingPercent: 28 }]
    }
  ]
}

function poserApi(): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      getGitState: () => Promise.resolve(GIT),
      conversationGitState: () => Promise.resolve(GIT),
      conversationGitDiff: () => Promise.resolve({ available: true, diff: '' }),
      getGitDiff: () => Promise.resolve({ available: true, diff: '' }),
      brainTraces: () => Promise.resolve([]),
      getAutoClose: () => Promise.resolve({ enabled: false }),
      setAutoClose: () => Promise.resolve({ enabled: false }),
      onWorktreeActivity: () => () => {},
      onPilotEvent: () => () => {},
      onAppEvent: () => () => {},
      modelQuotas: async () => QUOTAS
    }
  })
}

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(element: React.ReactElement): Promise<HTMLDivElement> {
  poserApi()
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(element)
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  document.body.replaceChildren()
  root = null
  hote = null
  localStorage.clear()
  appliquerLangue('fr')
})

const clic = async (cible: Element | null): Promise<void> => {
  await act(async () => {
    ;(cible as HTMLElement).click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('panneaux du chat — langue', () => {
  it('le contrôle de source bascule en anglais sans être remonté, puis revient au français', async () => {
    const zone = await monter(createElement(SourceControlPane, { conversationId: 'conv-a' }))
    const onglet = (id: string): Element | null => zone.querySelector(`[data-testid="${id}"]`)
    expect(onglet('sc-repo-project')?.textContent).toBe('Fichiers')
    expect(zone.textContent).toContain('Modifiés par cette conversation · 2')

    await act(async () => appliquerLangue('en'))
    expect(onglet('sc-repo-project')?.textContent).toBe('Files')
    expect(onglet('sc-repo-project')?.getAttribute('title')).toBe(
      'Files changed by this conversation'
    )
    expect(onglet('sc-view-tree')?.textContent).toBe('Project')
    expect(zone.textContent).toContain('Changed by this conversation · 2')

    await clic(onglet('sc-view-workspace'))
    expect(zone.textContent).toContain('Branch')
    expect(zone.textContent).toContain('Steps')
    expect(zone.textContent).toContain('Auto chaining')
    const flux = onglet('sc-git-flux')?.textContent ?? ''
    expect(flux).toContain('Pull')
    expect(flux).toContain('2 commits from the remote to merge')
    expect(flux).toContain('2 files changed — summary then commit')
    expect(flux).toContain('Open a PR')

    await act(async () => appliquerLangue('fr'))
    expect(zone.textContent).toContain('Branche')
    expect(zone.textContent).toContain('Enchaînement auto')
    expect(onglet('sc-git-flux')?.textContent).toContain('2 commits du distant à intégrer')
    expect(onglet('sc-git-flux')?.textContent).toContain('2 fichiers modifiés — résumé puis commit')
  })

  it('l’indicateur de quotas bascule en anglais, puis revient au français', async () => {
    const zone = await monter(createElement(ModelQuotaIndicator))
    await clic(zone.querySelector('.model-quota-bar-fill'))
    const popup = (): string =>
      document.body.querySelector('[data-testid="model-quota-popover"]')?.textContent ?? ''
    expect(popup()).toContain('Quota partagé')

    await act(async () => appliquerLangue('en'))
    expect(popup()).toContain('Shared quota')
    expect(popup()).toContain('Provider quotas')
    expect(popup()).toContain('72% used')
    expect(popup()).toContain('28% left')
    expect(popup()).toContain('Stale reading')
    expect(popup()).toContain('reset not exposed')
    expect(document.body.querySelector('button[aria-label="Refresh the quotas"]')).not.toBeNull()

    await act(async () => appliquerLangue('fr'))
    expect(popup()).toContain('Quota partagé')
    expect(popup()).toContain('72 % utilisé')
    expect(document.body.querySelector('button[aria-label="Actualiser les quotas"]')).not.toBeNull()
  })
})
