// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { ModelQuotaIndicator } from './ModelQuotaIndicator'
import type { OrchestratorAccounts } from './OrchestratorModelSelector'

/**
 * LA BARRE DE QUOTA PARLE DU MÊME COMPTE QUE LA PUCE (conv-1416, 2026-11-01).
 *
 * Constat de conv-1403 : puce sur le compte pro, barre sur gmail. La puce suit le choix du fil, la barre
 * suivait le compte actif de l'application. L'indicateur demande désormais le quota du compte du fil.
 */
const instantane = {
  observedAt: '2026-11-01T05:30:00.000Z',
  summary: { remainingPercent: 28, status: 'warning' },
  models: []
}

const comptes = (selectedId?: string): OrchestratorAccounts => ({
  accounts: [
    { id: 'default', displayName: 'Compte pro', tier: 'team' },
    { id: 'compte-3', displayName: 'Compte gmail', tier: 'max' }
  ],
  ...(selectedId ? { selectedId } : {}),
  activeId: 'compte-3',
  busy: false,
  error: null,
  onSelect: () => {}
})

describe('barre de quota — compte du fil', () => {
  let root: Root | undefined
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })
  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    document.body.replaceChildren()
  })

  async function afficher(selection: OrchestratorAccounts): Promise<void> {
    if (!root) {
      const conteneur = document.createElement('div')
      document.body.append(conteneur)
      root = createRoot(conteneur)
    }
    await act(async () => {
      root?.render(createElement(ModelQuotaIndicator, { comptes: selection }))
      await Promise.resolve()
    })
  }

  function brancher(): ReturnType<typeof vi.fn> {
    const modelQuotas = vi.fn(async () => instantane)
    Object.defineProperty(window, 'api', { configurable: true, value: { modelQuotas } })
    return modelQuotas
  }

  it('fil au compte choisi : la barre demande le quota de CE compte', async () => {
    const modelQuotas = brancher()
    await afficher(comptes('default'))
    expect(modelQuotas).toHaveBeenLastCalledWith(false, 'default')
  })

  it('changer de fil ou de compte relit le quota aussitôt', async () => {
    const modelQuotas = brancher()
    await afficher(comptes('default'))
    await afficher(comptes('compte-3'))
    expect(modelQuotas).toHaveBeenLastCalledWith(false, 'compte-3')
  })

  it('fil sans compte choisi : la barre suit le compte de l’application, comme avant', async () => {
    const modelQuotas = brancher()
    await afficher(comptes())
    expect(modelQuotas).toHaveBeenLastCalledWith()
  })

  it('l’actualisation forcée vise aussi le compte du fil', async () => {
    const modelQuotas = brancher()
    await afficher(comptes('default'))
    await act(async () => {
      window.dispatchEvent(new CustomEvent('autowin:quotas-stale'))
      await Promise.resolve()
    })
    expect(modelQuotas).toHaveBeenLastCalledWith(true, 'default')
  })
})
