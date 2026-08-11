// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentStudioView } from './AgentStudioView'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  // Ce test vérifie le CÂBLAGE, pas le contenu des autres sections : plutôt que de simuler toute
  // l'API pour les vues voisines, on rend n'importe quel appel inoffensif.
  const connu: Record<string, unknown> = {
    workflowProfiles: vi.fn().mockResolvedValue({ profiles: [], activeId: null }),
    onAppEvent: vi.fn(() => vi.fn())
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: new Proxy(connu, {
      get: (cible, propriete: string) =>
        cible[propriete] ?? (cible[propriete] = vi.fn().mockResolvedValue([]))
    })
  })
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

async function render(section: 'topology' | 'routing' | 'workflows'): Promise<void> {
  await act(async () => {
    root.render(
      createElement(AgentStudioView, { active: true, section, onSectionChange: () => undefined })
    )
    await Promise.resolve()
    await Promise.resolve()
  })
}

/**
 * Le composant Workflows peut être parfait : s'il n'est atteint par aucune section, il n'existe pas
 * pour l'utilisateur. C'est le câblage qu'on vérifie ici, pas le contenu.
 */
describe('Agent Studio — la section Workflows est ATTEIGNABLE', () => {
  it('affiche un onglet Workflows', async () => {
    // Rendu sur la section workflows : l'onglet est présent quelle que soit la section, et on évite
    // de monter la vue topologie qui exige toute une API sans rapport avec ce câblage.
    await render('workflows')
    const onglets = [...container.querySelectorAll('.domain-tabs button')].map((b) =>
      b.textContent?.trim()
    )
    expect(onglets).toContain('Workflows')
  })

  it('la section workflows rend bien la vue des workflows', async () => {
    await render('workflows')
    expect(container.querySelector('[data-testid="workflow-profiles-view"]')).not.toBeNull()
  })

  it('les autres sections ne la rendent pas', async () => {
    await render('routing')
    expect(container.querySelector('[data-testid="workflow-profiles-view"]')).toBeNull()
  })

  it('cliquer l’onglet demande le changement de section', async () => {
    const onSectionChange = vi.fn()
    await act(async () => {
      root.render(
        createElement(AgentStudioView, { active: true, section: 'routing', onSectionChange })
      )
      await Promise.resolve()
    })
    const onglet = [...container.querySelectorAll<HTMLButtonElement>('.domain-tabs button')].find(
      (b) => b.textContent?.trim() === 'Workflows'
    )!
    await act(async () => onglet.click())
    expect(onSectionChange).toHaveBeenCalledWith('workflows')
  })
})

/** Une topologie minimale mais VALIDE : le proxy générique rend `[]`, que la vue ne sait pas lire. */
const topologieVide = {
  version: 1,
  orchestrator: {
    slotId: 'orchestrator',
    provider: 'codex',
    modelId: 'gpt',
    reasoningEffort: 'auto'
  },
  subagents: [],
  panels: { scout: [], frame: [], terrain: [], judge: [] }
}

function stub(overrides: Record<string, unknown> = {}): void {
  const connu: Record<string, unknown> = {
    topology: vi.fn().mockResolvedValue(topologieVide),
    models: vi.fn().mockResolvedValue([]),
    profiles: vi.fn().mockResolvedValue([]),
    providerStatus: vi.fn().mockResolvedValue([]),
    workflowProfiles: vi.fn().mockResolvedValue({ profiles: [], activeId: null }),
    onAppEvent: vi.fn(() => vi.fn()),
    ...overrides
  }
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: new Proxy(connu, {
      get: (cible, propriete: string) =>
        cible[propriete] ?? (cible[propriete] = vi.fn().mockResolvedValue([]))
    })
  })
}

/**
 * Finding 7 : la section PAR DÉFAUT (`topology`) n'était jamais rendue par ce test — le câblage le
 * plus emprunté de la vue n'était donc couvert par rien.
 */
describe('Agent Studio — la section par défaut est CÂBLÉE', () => {
  it('la section topology rend la vue Modèles & topologie', async () => {
    stub()
    await render('topology')
    expect(container.querySelector('.agents-topology')).not.toBeNull()
    expect(container.querySelector('[data-testid="workflow-profiles-view"]')).toBeNull()
  })

  it('l’onglet topology est marqué actif', async () => {
    stub()
    await render('topology')
    const onglet = [...container.querySelectorAll<HTMLButtonElement>('.domain-tabs button')].find(
      (b) => b.textContent?.includes('topologie')
    )!
    expect(onglet.getAttribute('aria-pressed')).toBe('true')
  })
})

/**
 * Finding 6 : une anomalie (provider expiré, workflow injouable) n'était visible qu'en OUVRANT
 * l'onglet concerné. Un prompt partait donc sur une configuration cassée que rien n'annonçait.
 */
describe('Agent Studio — les onglets annoncent les anomalies', () => {
  it('signale les providers expirés sur l’onglet Routage', async () => {
    stub({
      providerStatus: vi.fn().mockResolvedValue([
        { provider: 'codex', status: 'expired', testable: true },
        { provider: 'claude', status: 'authenticated', testable: true }
      ])
    })
    await render('topology')
    const badge = container.querySelector('[data-testid="studio-anomaly-routing"]')
    expect(badge).not.toBeNull()
    expect(badge?.textContent).toContain('1')
    expect(badge?.getAttribute('title')).toContain('codex')
  })

  it('signale les workflows non exécutables sur l’onglet Workflows', async () => {
    stub({
      workflowProfiles: vi.fn().mockResolvedValue({
        profiles: [{ id: 'casse', name: 'Cassé', phases: ['inconnue'] }],
        activeId: null
      })
    })
    await render('topology')
    const badge = container.querySelector('[data-testid="studio-anomaly-workflows"]')
    expect(badge?.textContent).toContain('1')
    expect(badge?.getAttribute('title')).toContain('Cassé')
  })

  it('rien à signaler quand tout est sain', async () => {
    stub({
      providerStatus: vi
        .fn()
        .mockResolvedValue([{ provider: 'codex', status: 'authenticated', testable: true }]),
      workflowProfiles: vi.fn().mockResolvedValue({
        profiles: [{ id: 'ok', name: 'OK', phases: ['build'] }],
        activeId: null
      })
    })
    await render('topology')
    expect(container.querySelector('[data-testid="studio-anomaly-routing"]')).toBeNull()
    expect(container.querySelector('[data-testid="studio-anomaly-workflows"]')).toBeNull()
  })

  it('ne sonde rien tant qu’Agent Studio n’est pas ouvert', async () => {
    const providerStatus = vi.fn().mockResolvedValue([])
    stub({ providerStatus })
    await act(async () => {
      root.render(
        createElement(AgentStudioView, {
          active: false,
          section: 'topology',
          onSectionChange: () => undefined
        })
      )
      await Promise.resolve()
    })
    expect(providerStatus).not.toHaveBeenCalled()
  })

  it('rafraîchit les badges après les mutations de rôles et de workflows', async () => {
    const listeners: Array<(event: { type: string; scope?: string }) => void> = []
    const providerStatus = vi
      .fn()
      .mockResolvedValueOnce([{ provider: 'codex', status: 'expired', testable: true }])
      .mockResolvedValueOnce([{ provider: 'codex', status: 'authenticated', testable: true }])
    const workflowProfiles = vi
      .fn()
      .mockResolvedValueOnce({ profiles: [], activeId: null })
      .mockResolvedValueOnce({
        profiles: [{ id: 'casse', name: 'Cassé', phases: ['inconnue'] }],
        activeId: null
      })
    stub({
      providerStatus,
      workflowProfiles,
      onAppEvent: vi.fn((listener) => {
        listeners.push(listener)
        return vi.fn()
      })
    })
    await render('topology')
    expect(container.querySelector('[data-testid="studio-anomaly-routing"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="studio-anomaly-workflows"]')).toBeNull()

    await act(async () => {
      for (const listener of listeners) listener({ type: 'refresh', scope: 'roles' })
      for (const listener of listeners) listener({ type: 'refresh', scope: 'workflows' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(container.querySelector('[data-testid="studio-anomaly-routing"]')).toBeNull()
    expect(container.querySelector('[data-testid="studio-anomaly-workflows"]')).not.toBeNull()
  })
})
