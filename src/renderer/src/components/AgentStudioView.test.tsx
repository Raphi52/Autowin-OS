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
