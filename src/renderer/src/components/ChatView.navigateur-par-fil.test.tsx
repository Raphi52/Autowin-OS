// @vitest-environment happy-dom
/**
 * DÉFAUT VÉCU (2026-11-17) : « quand j'ai send ça m'a ouvert le navigateur intégré sans raison sans
 * ouvrir de page web ». Le navigateur était ouvert dans le fil précédent ; « Nouveau fil » le
 * masquait seulement (pas de fil, rien à montrer), et l'envoi du premier message, en créant le fil,
 * le faisait réapparaître vide : « Aucune page ouverte ». Ses onglets vivent par fil, son panneau
 * aussi.
 *
 * Entrées qui doivent faire échouer ce fichier : un panneau qui suit l'utilisateur dans un autre
 * fil, qui surgit dans un fil neuf à l'envoi, ou qui ne revient pas avec le fil qui l'avait ouvert.
 */
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

const panneauNavigateur = (c: Element): Element | null =>
  c.querySelector('[data-testid="navigateur-panneau"]')

function navigateurFactice(): Record<string, unknown> {
  return {
    etat: vi.fn(async (conversationId: string) => ({
      conversationId,
      onglets: [],
      ongletActif: null,
      agentPilote: false,
      mode: null,
      nombreElementsChoisis: 0,
      gestes: [],
      pilotage: 'libre'
    })),
    surEtat: vi.fn(() => () => undefined),
    afficherFil: vi.fn(async () => undefined),
    poserCadre: vi.fn(async () => undefined),
    prendreElementsChoisis: vi.fn(async () => []),
    reglages: {
      lire: vi.fn(async () => ({ ouvrirLiensDuChatIci: false })),
      ecrire: vi.fn()
    }
  }
}

async function laisserFiler(): Promise<void> {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0))
  })
}

describe('ChatView — le navigateur intégré appartient à son fil', () => {
  beforeAll(installRafShim)
  let h: ChatHarness | undefined

  afterEach(async () => {
    await h?.unmount()
    h = undefined
    window.localStorage.clear()
    sessionStorage.clear()
    vi.restoreAllMocks()
  })

  async function ouvrirLeFil(id: string): Promise<void> {
    await h!.click(`.conv-item[data-conversation-id="${id}"] .conv-pick`)
    await laisserFiler()
  }

  it('ouvert dans A, il ne suit pas dans B, et revient avec A', async () => {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A'), conversation('B')]),
        conversation: vi.fn(async (id: string) => conversation(id)),
        navigateur: navigateurFactice()
      })
    )
    await ouvrirLeFil('A')
    await h.click('[data-testid="chat-navigateur-toggle"]')
    expect(panneauNavigateur(h.container)).not.toBeNull()

    await ouvrirLeFil('B')
    expect(panneauNavigateur(h.container)).toBeNull()

    await ouvrirLeFil('A')
    expect(panneauNavigateur(h.container)).not.toBeNull()
  })

  it('ouvert dans A, il ne surgit pas dans le fil neuf que crée l’envoi', async () => {
    h = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A')]),
        conversation: vi.fn(async (id: string) => conversation(id)),
        conversationsCreate: vi.fn().mockResolvedValue(conversation('neuf')),
        navigateur: navigateurFactice()
      })
    )
    await ouvrirLeFil('A')
    await h.click('[data-testid="chat-navigateur-toggle"]')
    expect(panneauNavigateur(h.container)).not.toBeNull()

    await h.click('.conv-new-row')
    expect(panneauNavigateur(h.container)).toBeNull()
    await h.type('explique vite fait ce qui s’est passé ?')
    await h.click('.composer-send')
    await laisserFiler()

    expect(panneauNavigateur(h.container)).toBeNull()
  })
})
