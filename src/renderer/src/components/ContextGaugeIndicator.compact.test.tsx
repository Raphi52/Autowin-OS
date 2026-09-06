// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ContextGaugeIndicator } from './ContextGaugeIndicator'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import type { ContextGauge } from '../../../shared/context-gauge'

/**
 * Le bouton COMPACTER, dans le panneau propre a la jauge de contexte.
 *
 * Entrees qui feraient echouer ce test si la correction etait fausse :
 *  - `gauge={undefined}` (occupation inconnue) DOIT laisser le panneau SANS bouton : proposer de
 *    compacter un fil dont on ignore le remplissage est une action sur une mesure inventee.
 *  - `busy` (un tour est deja en cours) DOIT rendre le bouton desactive : un rendu inconditionnel
 *    enverrait une demande de compaction pendant que l'agent repond.
 * Un bouton rendu en dur passerait le premier cas et echouerait sur ces deux-la.
 */
const jauge: ContextGauge = {
  used: 170_000,
  limit: 200_000,
  ratio: 0.85,
  level: 'critique',
  cacheRead: 150_000,
  fresh: 20_000
}

async function ouvrir(props: {
  gauge?: ContextGauge
  onCompact?: () => void
  busy?: boolean
}): Promise<HTMLElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(createElement(ContextGaugeIndicator, props))
    await Promise.resolve()
  })
  const trigger = container.querySelector(
    '[data-testid="chat-context-gauge"]'
  ) as HTMLButtonElement | null
  if (trigger) await act(async () => trigger.click())
  return container
}

describe('bouton Compacter dans le panneau de contexte', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(() => {
    document.body.replaceChildren()
    vi.restoreAllMocks()
  })

  it('declenche la compaction quand le contexte est mesure', async () => {
    const onCompact = vi.fn()
    const container = await ouvrir({ gauge: jauge, onCompact })
    const bouton = container.querySelector(
      '[data-testid="quota-context-compact"]'
    ) as HTMLButtonElement
    expect(bouton).not.toBeNull()
    expect(bouton.disabled).toBe(false)
    await act(async () => bouton.click())
    expect(onCompact).toHaveBeenCalledTimes(1)
  })

  it("n'affiche AUCUN bouton quand le contexte n'est pas mesure", async () => {
    const container = await ouvrir({ gauge: undefined, onCompact: vi.fn() })
    expect(container.querySelector('[data-testid="quota-context-compact"]')).toBeNull()
  })

  it("n'affiche AUCUN bouton sans gestionnaire de compaction", async () => {
    const container = await ouvrir({ gauge: jauge })
    expect(container.querySelector('[data-testid="quota-context-compact"]')).toBeNull()
  })

  it('desactive le bouton pendant un tour en cours', async () => {
    const onCompact = vi.fn()
    const container = await ouvrir({ gauge: jauge, onCompact, busy: true })
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
