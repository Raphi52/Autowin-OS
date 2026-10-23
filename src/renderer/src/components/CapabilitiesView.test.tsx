// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { CapabilitiesView } from './CapabilitiesView'

describe('Capabilities plugins wiring', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  // Le registre est choisi par la section de Settings depuis conv-1109, plus par un onglet interne.
  it('loads the plugins registry when its section opens it, without internal tabs', async () => {
    const capabilityControls = vi.fn(async (kind: string) =>
      kind === 'plugins'
        ? [
            {
              id: 'plugin-a',
              label: 'Plugin A',
              description: 'Connecteur',
              enabled: true,
              mutable: false
            }
          ]
        : []
    )
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        skills: vi.fn(async () => []),
        claudeHooks: vi.fn(async () => []),
        codexHooks: vi.fn(async () => []),
        toolUsage: vi.fn(async () => []),
        capabilityControls,
        setCapabilityTool: vi.fn()
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(CapabilitiesView, { active: true, kind: 'plugins' }))
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(capabilityControls).toHaveBeenCalledWith('plugins')
    expect(container.textContent).toContain('Plugin A')
    expect(container.querySelector('h1')?.textContent).toBe('Mods')
    expect(container.querySelector('[role="tab"]')).toBeNull()
    await act(async () => root.unmount())
    container.remove()
  })
})

describe('Capabilities — états dégradés honnêtes', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  async function mount(api: Record<string, unknown>): Promise<{
    root: ReturnType<typeof createRoot>
    container: HTMLDivElement
  }> {
    Object.defineProperty(window, 'api', { configurable: true, value: api })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(createElement(CapabilitiesView, { active: true }))
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    })
    return { root, container }
  }

  it("isole l'échec du catalogue de relations sans contaminer la liste principale", async () => {
    const { root, container } = await mount({
      skills: vi.fn(async () => [
        { id: 's1', label: 'Alpha', description: 'skill alpha', enabled: true, mutable: false }
      ]),
      claudeHooks: vi.fn(async () => [
        { id: 'h1', label: 'Alpha hook', description: 'hook alpha', enabled: true, mutable: false }
      ]),
      codexHooks: vi.fn(async () => {
        throw new Error('codex KO')
      }),
      toolUsage: vi.fn(async () => []),
      capabilityControls: vi.fn(async () => []),
      setCapabilityTool: vi.fn()
    })

    expect(container.textContent).toContain('Alpha')
    expect(container.querySelector('.control-error')).toBeNull()
    // Les relations issues des sources SAINES restent rendues.
    expect(container.querySelector('.related-list')?.textContent).toContain('Alpha hook')
    // …et l'indisponibilité partielle est SIGNALÉE, pas avalée.
    expect(container.querySelector('[data-testid="relations-partial"]')?.textContent).toMatch(
      /partiel|indispo/i
    )
    await act(async () => root.unmount())
    container.remove()
  })

  it("propose d'afficher les désactivées avec leur compteur au lieu d'un faux état vide", async () => {
    const { root, container } = await mount({
      skills: vi.fn(async () => [
        { id: 's1', label: 'Alpha', description: 'a', enabled: false, mutable: false },
        { id: 's2', label: 'Beta', description: 'b', enabled: false, mutable: false }
      ]),
      claudeHooks: vi.fn(async () => []),
      codexHooks: vi.fn(async () => []),
      toolUsage: vi.fn(async () => []),
      capabilityControls: vi.fn(async () => []),
      setCapabilityTool: vi.fn()
    })

    const reveal = container.querySelector(
      '[data-testid="capabilities-reveal-disabled"]'
    ) as HTMLButtonElement
    expect(reveal).toBeTruthy()
    expect(reveal.textContent).toContain('2')
    expect(container.textContent).not.toContain('Aucune skill trouvée.')
    await act(async () => {
      reveal.click()
      await Promise.resolve()
    })
    expect(container.textContent).toContain('Alpha')
    expect(container.textContent).toContain('Beta')
    await act(async () => root.unmount())
    container.remove()
  })
})
