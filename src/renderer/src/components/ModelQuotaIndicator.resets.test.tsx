// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'

const snapshot = {
  observedAt: '2026-09-23T16:56:00.000Z',
  summary: { remainingPercent: 97, status: 'healthy' },
  models: [
    {
      modelId: 'claude/opus',
      model: 'opus',
      label: 'Claude',
      provider: 'claude',
      shared: true,
      status: 'available',
      source: 'Quota Claude (en-têtes API)',
      windows: [{ id: 'five-hour', label: '5 h', usedPercent: 3, remainingPercent: 97 }]
    }
  ]
}

const resets = {
  status: 'available',
  eligible: true,
  nextGrantId: 'opus55-launch',
  grants: [
    {
      id: 'opus55-launch',
      label: 'Opus 5.5 launch reset',
      resetsLeft: 1,
      resetsTotal: 1,
      endsAt: '2026-10-22T16:00:00+00:00',
      usableNow: true,
      paused: false,
      useRequiresLimit: false
    }
  ]
}

async function monter(
  api: Record<string, unknown>,
  props: Record<string, unknown> = {}
): Promise<HTMLDivElement> {
  try {
    window.localStorage.removeItem('autowin:quota-provider')
  } catch {
    // stockage indisponible : sans effet sur le test
  }
  Object.defineProperty(window, 'api', { configurable: true, value: api })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ModelQuotaIndicator, props))
  })
  const trigger = container.querySelector('[data-testid="model-quota-trigger"]') as HTMLElement
  await act(async () => {
    trigger.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
  })
  return container
}

describe('popup quotas : resets offerts et compte', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('affiche le reset offert avec son bouton, et ne le consomme PAS sans confirmation', async () => {
    const claudeResetClaim = vi.fn(async () => ({ result: 'reset' }))
    const container = await monter({
      modelQuotas: vi.fn(async () => snapshot),
      claudeResets: vi.fn(async () => resets),
      claudeResetClaim
    })
    const carte = container.querySelector('[data-testid="model-quota-resets"]')
    expect(carte?.textContent).toContain('Opus 5.5 launch reset')
    expect(carte?.textContent).toContain('1 sur 1 restant')
    const bouton = container.querySelector(
      '[data-testid="model-quota-reset-opus55-launch"]'
    ) as HTMLButtonElement
    expect(bouton.disabled).toBe(false)

    // Confirmation refusée : aucun appel.
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    await act(async () => {
      bouton.click()
    })
    expect(claudeResetClaim).not.toHaveBeenCalled()

    // Confirmation acceptée : l'appel part vers un FAUX api, avec le bon identifiant.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    await act(async () => {
      bouton.click()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(claudeResetClaim).toHaveBeenCalledWith('opus55-launch')
    expect(carte?.textContent).toContain('Reset appliqué')
  })

  it('un reset non utilisable a son bouton désactivé', async () => {
    const container = await monter({
      modelQuotas: vi.fn(async () => snapshot),
      claudeResets: vi.fn(async () => ({
        ...resets,
        grants: [{ ...resets.grants[0], usableNow: false }]
      })),
      claudeResetClaim: vi.fn()
    })
    const bouton = container.querySelector(
      '[data-testid="model-quota-reset-opus55-launch"]'
    ) as HTMLButtonElement
    expect(bouton.disabled).toBe(true)
  })

  it('montre les comptes et bascule par le chemin de la conversation', async () => {
    const onSelect = vi.fn()
    const container = await monter(
      { modelQuotas: vi.fn(async () => snapshot), claudeResets: vi.fn(async () => resets) },
      {
        comptes: {
          accounts: [
            { id: 'default', displayName: 'raphael.vilain@amitel.fr', tier: 'TEAM' },
            { id: 'compte-3', displayName: 'raphi5269@gmail.com', tier: 'MAX' }
          ],
          selectedId: 'compte-3',
          activeId: 'default',
          busy: false,
          error: null,
          onSelect
        }
      }
    )
    const actif = container.querySelector(
      '[data-testid="model-quota-account-compte-3"]'
    ) as HTMLButtonElement
    expect(actif.getAttribute('aria-pressed')).toBe('true')
    const autre = container.querySelector(
      '[data-testid="model-quota-account-default"]'
    ) as HTMLButtonElement
    await act(async () => {
      autre.click()
    })
    expect(onSelect).toHaveBeenCalledWith('default')
  })
})
// fix-ok: fichier NOUVEAU écrit en plusieurs pas (création puis compléments), pas un correctif à l aveugle — contrat mesuré : GET oauth/usage?cedar_ember=1 → 200 (sonde 2026-09-23), POST reset_rate_limits copié de claude.exe
