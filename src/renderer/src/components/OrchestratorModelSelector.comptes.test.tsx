// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { OrchestratorModelSelector } from './OrchestratorModelSelector'

/**
 * LE COMPTE CLAUDE SE CHOISIT DANS LA POP-UP DE MODELE, a l'echelle de la conversation.
 *
 * Avant : la pop-up ne proposait que le modele ; le compte ne se changeait que dans Routage, et
 * globalement. Ces trois assertions sont ce qui interdit le retour en arriere.
 */
const modeles = [
  {
    id: 'claude:opus',
    provider: 'claude',
    model: 'opus',
    label: 'Opus',
    reasoningEfforts: ['medium'],
    defaultReasoningEffort: 'medium'
  }
]

describe('OrchestratorModelSelector — compte de la conversation', () => {
  beforeAll(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  let root: Root | null = null
  let host: HTMLDivElement | null = null

  afterEach(async () => {
    if (root) await act(async () => root?.unmount())
    host?.remove()
    root = null
    host = null
  })

  const monter = async (comptes?: Parameters<typeof OrchestratorModelSelector>[0]['comptes']) => {
    host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => {
      root?.render(
        createElement(OrchestratorModelSelector, {
          busy: false,
          catalogLoaded: true,
          models: modeles,
          binding: { provider: 'claude', model: 'opus', reasoningEffort: 'medium' },
          pending: false,
          error: null,
          onSelect: () => {},
          comptes
        })
      )
    })
    return host
  }

  const deuxComptes = [
    { id: 'default', displayName: 'Compte principal', tier: 'max' },
    { id: 'compte-2', displayName: 'Compte pro', tier: 'team' }
  ]

  it('sans prop comptes, aucun bloc de compte (cas de Routage : rien ne change)', async () => {
    const hote = await monter(undefined)
    expect(hote.querySelector('[data-testid="conv-claude-accounts"]')).toBeNull()
  })

  it('affiche les comptes et marque celui de la conversation, pas celui de l’application', async () => {
    const hote = await monter({
      accounts: deuxComptes,
      selectedId: 'compte-2',
      activeId: 'default',
      busy: false,
      error: null,
      onSelect: () => {}
    })
    expect(hote.querySelector('[data-testid="conv-claude-accounts"]')).not.toBeNull()
    const choisi = hote.querySelector('[data-testid="conv-claude-account-compte-2"]')
    const autre = hote.querySelector('[data-testid="conv-claude-account-default"]')
    expect(choisi?.getAttribute('aria-pressed')).toBe('true')
    expect(autre?.getAttribute('aria-pressed')).toBe('false')
  })

  it('un clic sur une puce remonte l’id du compte choisi', async () => {
    const onSelect = vi.fn()
    const hote = await monter({
      accounts: deuxComptes,
      selectedId: undefined,
      activeId: 'default',
      busy: false,
      error: null,
      onSelect
    })
    await act(async () => {
      hote.querySelector<HTMLButtonElement>('[data-testid="conv-claude-account-compte-2"]')?.click()
    })
    expect(onSelect).toHaveBeenCalledWith('compte-2')
  })
})
