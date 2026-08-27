// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import type { ContextGauge } from '../../../shared/context-gauge'

/**
 * Le bouton COMPACTER, a cote de la jauge de contexte, dans la popup des quotas.
 *
 * Entrees qui feraient echouer ce test si la correction etait fausse :
 *  - `contextGauge={undefined}` (occupation inconnue) DOIT laisser la popup SANS bouton : proposer
 *    de compacter un fil dont on ignore le remplissage est une action sur une mesure inventee.
 *  - `busy` (un tour est deja en cours) DOIT rendre le bouton desactive : un rendu inconditionnel
 *    enverrait une demande de compaction pendant que l'agent repond.
 * Un bouton rendu en dur passerait le premier cas et echouerait sur ces deux-la.
 */
const snapshot = {
  observedAt: '2026-08-27T10:00:00.000Z',
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
      observedAt: '2026-08-27T10:00:00.000Z',
      windows: [
        {
          id: 'five-hour',
          label: '5 h',
          usedPercent: 45,
          remainingPercent: 55,
          resetsAt: '2026-08-27T14:00:00.000Z'
        }
      ]
    }
  ]
}

const jauge: ContextGauge = {
  used: 170_000,
  limit: 200_000,
  ratio: 0.85,
  level: 'critique',
  cacheRead: 150_000,
  fresh: 20_000
}

async function ouvrir(props: {
  contextGauge?: ContextGauge
  onCompact?: () => void
  busy?: boolean
}): Promise<HTMLElement> {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: { modelQuotas: vi.fn(async () => snapshot) }
  })
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ModelQuotaIndicator, { provider: 'claude', ...props }))
    await Promise.resolve()
  })
  const trigger = container.querySelector(
    '[data-testid="model-quota-trigger"]'
  ) as HTMLButtonElement
  await act(async () => trigger.click())
  return container
}

describe('bouton Compacter dans la popup des quotas', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('declenche la compaction quand le contexte est mesure', async () => {
    const onCompact = vi.fn()
    const container = await ouvrir({ contextGauge: jauge, onCompact })
    const bouton = container.querySelector(
      '[data-testid="quota-context-compact"]'
    ) as HTMLButtonElement
    expect(bouton).not.toBeNull()
    expect(bouton.disabled).toBe(false)
    await act(async () => bouton.click())
    expect(onCompact).toHaveBeenCalledTimes(1)
  })

  it("n'affiche AUCUN bouton quand le contexte n'est pas mesure", async () => {
    const container = await ouvrir({ contextGauge: undefined, onCompact: vi.fn() })
    expect(container.querySelector('[data-testid="quota-context-compact"]')).toBeNull()
  })

  it("n'affiche AUCUN bouton sans gestionnaire de compaction", async () => {
    const container = await ouvrir({ contextGauge: jauge })
    expect(container.querySelector('[data-testid="quota-context-compact"]')).toBeNull()
  })

  it('desactive le bouton pendant un tour en cours', async () => {
    const onCompact = vi.fn()
    const container = await ouvrir({ contextGauge: jauge, onCompact, busy: true })
    const bouton = container.querySelector(
      '[data-testid="quota-context-compact"]'
    ) as HTMLButtonElement
    expect(bouton).not.toBeNull()
    expect(bouton.disabled).toBe(true)
    await act(async () => bouton.click())
    expect(onCompact).not.toHaveBeenCalled()
  })

  it('est CABLE dans ChatView sur la demande de compaction partagee', () => {
    const source = readFileSync(join(__dirname, 'ChatView.tsx'), 'utf8').replace(/\s+/g, ' ')
    expect(source).toContain('onCompact={')
    expect(source).toContain('COMPACT_REQUEST')
    expect(COMPACT_REQUEST.length).toBeGreaterThan(40)
  })
})
