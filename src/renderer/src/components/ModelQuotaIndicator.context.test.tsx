// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import type { ContextGauge } from '../../../shared/context-gauge'

/**
 * La jauge de CONTEXTE dans la popup des quotas.
 *
 * Entrée qui ferait échouer ce test si la correction était fausse : `contextGauge={undefined}`
 * (fenêtre du modèle inconnue ou entrée non mesurée) DOIT laisser la popup sans jauge — un rendu
 * inconditionnel afficherait « 0 % », c'est-à-dire « ce fil est vide », une affirmation là où la
 * vérité est « on l'ignore ». Le second cas du test verrouille exactement cette absence.
 */
const snapshot = {
  observedAt: '2026-08-26T10:00:00.000Z',
  summary: { remainingPercent: 55, status: 'healthy' as const },
  models: [
    {
      modelId: 'claude/opus',
      model: 'opus',
      label: 'Claude Opus',
      provider: 'claude',
      shared: true,
      status: 'fresh' as const,
      source: 'Claude /usage',
      observedAt: '2026-08-26T10:00:00.000Z',
      windows: [
        {
          id: 'five-hour',
          label: '5 h',
          usedPercent: 45,
          remainingPercent: 55,
          resetsAt: '2026-08-26T14:00:00.000Z'
        }
      ]
    }
  ]
}

async function ouvrir(gauge?: ContextGauge): Promise<HTMLElement> {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { modelQuotas: vi.fn(async () => snapshot) }
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ModelQuotaIndicator, { provider: 'claude', contextGauge: gauge }))
    await Promise.resolve()
  })
  const trigger = container.querySelector(
    '[data-testid="model-quota-trigger"]'
  ) as HTMLButtonElement
  await act(async () => trigger.click())
  return container
}

describe('jauge de contexte dans la popup des quotas', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('affiche le remplissage du contexte quand il est mesuré', async () => {
    const container = await ouvrir({
      used: 120_000,
      limit: 200_000,
      ratio: 0.6,
      level: 'tendu',
      cacheRead: 90_000,
      fresh: 30_000
    })
    const jauge = container.querySelector('[data-testid="quota-context-gauge"]')
    expect(jauge).not.toBeNull()
    expect(jauge?.className).toContain('is-tendu')
    expect(jauge?.textContent).toContain('60 %')
    // Séparateur de milliers fr-FR = espace insécable étroite selon l'ICU : on compare au format
    // rendu par l'environnement, pas à une espace ordinaire écrite à la main.
    expect(jauge?.getAttribute('aria-label')).toContain((120_000).toLocaleString('fr-FR'))
    expect(jauge?.getAttribute('aria-label')).toContain((200_000).toLocaleString('fr-FR'))
    expect(
      (jauge?.querySelector('.quota-context-gauge-fill') as HTMLElement | null)?.style.width
    ).toBe('60%')
  })

  it("n'affiche AUCUNE jauge quand le contexte n'est pas mesuré", async () => {
    const container = await ouvrir(undefined)
    expect(container.querySelector('[data-testid="quota-context-gauge"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="model-quota-popover"]')?.textContent
    ).not.toContain('Contexte')
  })
})
