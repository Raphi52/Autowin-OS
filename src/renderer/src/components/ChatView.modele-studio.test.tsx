// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * LE MODÈLE CHOISI DANS UN FIL DEVIENT L'ORCHESTRATEUR D'AGENTS STUDIO (conv-1529, 2026-11-04 :
 * « quand je change de model et d'effort depuis un chat ca doit changer l'orchestrator de agents
 * studio »). Le fil garde son choix propre (conv-239) ; Agents Studio relit la topologie que
 * `setRole` réécrit. Montage réel de la vue : on clique un point de la grille modèle × effort de
 * l'en-tête, comme l'utilisateur.
 */
const OPUS = {
  id: 'opus',
  provider: 'claude',
  model: 'claude-opus-5-5',
  label: 'Opus 5.5',
  reasoningEfforts: ['low', 'high']
}

const regler = async (): Promise<void> => {
  await act(async () => {
    await new Promise((fin) => setTimeout(fin, 0))
  })
}

async function ouvrirLeSelecteur(h: ChatHarness): Promise<void> {
  const details = h.container.querySelector(
    '[data-testid="chat-orchestrator-model"] details, details[data-testid="chat-orchestrator-model"]'
  ) as HTMLDetailsElement | null
  const cible =
    details ??
    (h.container
      .querySelector('[data-testid="chat-orchestrator-model"]')
      ?.closest('details') as HTMLDetailsElement | null)
  expect(cible).not.toBeNull()
  await act(async () => {
    cible!.open = true
    cible!.dispatchEvent(new Event('toggle'))
  })
}

/** Le geste réel : un point de la grille MODEL × EFFORT, sur la ligne du modèle. */
function cranDEffort(effort: string): Element | null {
  return document.body.querySelector(
    `[data-testid="effort-matrix"] [role="radio"][data-effort="${effort}"]`
  )
}

async function cliquer(element: Element | null | undefined): Promise<void> {
  expect(element).toBeTruthy()
  await act(async () => (element as HTMLElement).click())
  await regler()
}

describe('ChatView — le modèle du fil pilote l’orchestrateur d’Agents Studio', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | null = null

  afterEach(async () => {
    await h?.unmount()
    h = null
    document.body.innerHTML = ''
    vi.restoreAllMocks()
  })

  function api(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return chatApi({
      models: vi.fn().mockResolvedValue([OPUS]),
      conversationSetModel: vi.fn(
        async (_id: string, provider: string | null, model?: string, effort?: string) =>
          provider ? { provider, model, reasoningEffort: effort } : null
      ),
      setRole: vi.fn().mockResolvedValue({}),
      ...overrides
    })
  }

  it('modèle + effort choisis dans le fil : retenus sur le fil ET posés sur l’orchestrateur', async () => {
    const mock = api()
    h = await mountChat(mock)
    await h.click('.conv-pick')
    await ouvrirLeSelecteur(h)
    await cliquer(cranDEffort('high'))

    expect(mock.conversationSetModel).toHaveBeenCalledWith('A', 'claude', 'claude-opus-5-5', 'high')
    expect(mock.setRole).toHaveBeenCalledTimes(1)
    expect(mock.setRole).toHaveBeenCalledWith('orchestrator', 'claude', 'claude-opus-5-5', 'high')
  })

  it('revenir au modèle par défaut ne touche pas Agents Studio', async () => {
    const mock = api({
      conversations: vi.fn().mockResolvedValue([
        {
          ...conversation('A'),
          modeleChoisi: { provider: 'claude', model: 'claude-opus-5-5', reasoningEffort: 'high' }
        }
      ])
    })
    h = await mountChat(mock)
    await h.click('.conv-pick')
    await ouvrirLeSelecteur(h)
    await cliquer(document.body.querySelector('[data-testid="conv-model-defaut"] button'))

    expect(mock.conversationSetModel).toHaveBeenCalledWith('A', null, undefined, undefined)
    expect(mock.setRole).not.toHaveBeenCalled()
  })

  it('un refus d’Agents Studio se dit, et le choix du fil reste retenu', async () => {
    const mock = api({ setRole: vi.fn().mockRejectedValue(new Error('modèle inconnu')) })
    h = await mountChat(mock)
    await h.click('.conv-pick')
    await ouvrirLeSelecteur(h)
    await cliquer(cranDEffort('low'))

    expect(mock.conversationSetModel).toHaveBeenCalledWith('A', 'claude', 'claude-opus-5-5', 'low')
    expect(document.body.textContent).toMatch(/Agents Studio.*modèle inconnu/)
  })
})
