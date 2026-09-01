// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * PERTE DE DONNÉES UTILISATEUR — mesure du 2026-09-01 (conv-30).
 *
 * L'utilisateur a écrit deux messages pendant un tour ; ils ont disparu de l'écran quand il a écrit
 * le troisième, et les QUATRE sources de persistance (conversations.json, son journal, causal-trace,
 * prompt-observability) étaient vides. Cause : le composer se vide dès l'envoi, et un texte qui ne
 * produit aucun TOUR ne vit que dans des refs volatiles du renderer.
 *
 * Ces tests exigent que le texte atteigne le disque AVANT de quitter le composer — et surtout dans
 * le cas qui a coûté les messages : une injection REFUSÉE, qui n'atteint ni le modèle ni l'historique.
 */
describe('ChatView — le texte tapé est journalisé avant de partir', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(injectOk: boolean): Promise<{
    pilote: (event: Record<string, unknown>) => void
    journal: ReturnType<typeof vi.fn>
  }> {
    let pilote!: (event: Record<string, unknown>) => void
    const journal = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        journaliserSaisie: journal,
        injectDirective: vi.fn().mockResolvedValue({ ok: injectOk }),
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { pilote, journal }
  }

  async function taperPendantUnTour(
    pilote: (e: Record<string, unknown>) => void,
    texte: string
  ): Promise<void> {
    // Un tour doit tourner : c'est la condition qui transforme l'envoi en orientation.
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))
    await harness!.type(texte)
    await act(async () => {
      harness!
        .textarea()
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => {})
  }

  it('une injection REFUSÉE laisse quand même le texte sur le disque', async () => {
    const { pilote, journal } = await monter(false)
    await taperPendantUnTour(pilote, 'mon message qui allait disparaitre')
    expect(journal).toHaveBeenCalledWith('A', 'mon message qui allait disparaitre', 'orientation')
  })

  it('une injection acceptée est journalisée aussi — elle ne crée jamais de tour', async () => {
    const { pilote, journal } = await monter(true)
    await taperPendantUnTour(pilote, 'oriente le travail vers X')
    expect(journal).toHaveBeenCalledWith('A', 'oriente le travail vers X', 'orientation')
  })

  it('un journal en échec ne casse pas l’envoi — le filet ne devient jamais le défaut', async () => {
    let pilote!: (event: Record<string, unknown>) => void
    const injecte = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        journaliserSaisie: vi.fn().mockRejectedValue(new Error('disque plein')),
        injectDirective: injecte,
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await taperPendantUnTour(pilote, 'le message doit partir quand meme')
    expect(injecte).toHaveBeenCalledWith('A', 'le message doit partir quand meme')
  })
})
