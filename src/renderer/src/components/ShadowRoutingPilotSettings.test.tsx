// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SettingsView } from './SettingsView'
import { ShadowRoutingPilotSettings } from './ShadowRoutingPilotSettings'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const mounted: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(async () => {
  for (const item of mounted.splice(0)) {
    await act(async () => item.root.unmount())
    item.container.remove()
  }
})

async function mount(api: Record<string, unknown>): Promise<HTMLDivElement> {
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  mounted.push({ root, container })
  await act(async () => {
    root.render(createElement(ShadowRoutingPilotSettings))
  })
  return container
}

function toggleOf(container: HTMLDivElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>(
    '[data-testid="shadow-routing-pilot-toggle"]'
  )
  if (!input) throw new Error('case a cocher du pilote shadow absente')
  return input
}

describe('ShadowRoutingPilotSettings', () => {
  it('affiche le reglage decoche par defaut et explique ce que l app mesure', async () => {
    const container = await mount({
      shadowRoutingPilot: vi.fn().mockResolvedValue({
        enabled: false,
        active: false,
        envOverride: null
      }),
      setShadowRoutingPilot: vi.fn()
    })

    expect(toggleOf(container).checked).toBe(false)
    expect(toggleOf(container).disabled).toBe(false)
    expect(container.textContent).toContain('vert au coût le plus bas')
    expect(container.textContent).toContain('pilote shadow')
    expect(container.querySelector('[data-testid="shadow-routing-pilot-env"]')).toBeNull()
  })

  it('persiste l activation et confirme que la mesure a demarre', async () => {
    const setShadowRoutingPilot = vi
      .fn()
      .mockResolvedValue({ enabled: true, active: true, envOverride: null })
    const container = await mount({
      shadowRoutingPilot: vi
        .fn()
        .mockResolvedValue({ enabled: false, active: false, envOverride: null }),
      setShadowRoutingPilot
    })

    await act(async () => toggleOf(container).click())

    expect(setShadowRoutingPilot).toHaveBeenCalledWith(true)
    expect(toggleOf(container).checked).toBe(true)
    expect(container.querySelector('[role="status"]')?.textContent).toContain('Mesure active')
  })

  it('dit la verite quand l environnement surcharge le reglage', async () => {
    const container = await mount({
      shadowRoutingPilot: vi
        .fn()
        .mockResolvedValue({ enabled: true, active: false, envOverride: false }),
      setShadowRoutingPilot: vi.fn()
    })

    const note = container.querySelector('[data-testid="shadow-routing-pilot-env"]')
    expect(note?.textContent).toContain('AUTOWIN_MODEL_ROUTING_SHADOW_ENABLED')
    expect(note?.textContent).toContain('INACTIF')
  })

  it('signale un echec d enregistrement sans mentir sur l etat', async () => {
    const container = await mount({
      shadowRoutingPilot: vi
        .fn()
        .mockResolvedValue({ enabled: false, active: false, envOverride: null }),
      setShadowRoutingPilot: vi.fn().mockRejectedValue(new Error('disque plein'))
    })

    await act(async () => toggleOf(container).click())

    expect(container.textContent).toContain('disque plein')
    expect(toggleOf(container).checked).toBe(false)
  })

  it('reste actionnable quand la lecture echoue', async () => {
    const shadowRoutingPilot = vi
      .fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ enabled: false, active: false, envOverride: null })
    const container = await mount({ shadowRoutingPilot, setShadowRoutingPilot: vi.fn() })

    expect(container.querySelector('[role="alert"]')?.textContent).toContain('boom')
    expect(toggleOf(container).disabled).toBe(true)

    const retry = [...container.querySelectorAll('button')].find(
      (button) => button.textContent === 'Réessayer'
    )
    await act(async () => retry?.click())

    expect(container.querySelector('[role="alert"]')).toBeNull()
    expect(toggleOf(container).disabled).toBe(false)
  })
})

describe('vue Settings — section Budget', () => {
  it('expose la bascule du pilote shadow dans la vue existante', async () => {
    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        getPreflight: vi.fn().mockResolvedValue(null),
        recheckPreflight: vi.fn(),
        onPreflight: () => () => {},
        orchestrationBudget: vi
          .fn()
          .mockResolvedValue({ maxUsd: null, maxProviderCalls: 24, maxTotalTokens: 15_000_000 }),
        setOrchestrationBudget: vi.fn(),
        shadowRoutingPilot: vi
          .fn()
          .mockResolvedValue({ enabled: false, active: false, envOverride: null }),
        setShadowRoutingPilot: vi.fn()
      }
    })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    mounted.push({ root, container })

    await act(async () => {
      root.render(
        createElement(SettingsView, { active: true, section: 'budget', onSectionChange: vi.fn() })
      )
    })

    expect(container.querySelector('[data-testid="shadow-routing-pilot-toggle"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="shadow-routing-pilot"]')).toBeTruthy()
  })
})
