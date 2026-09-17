// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * PARITÉ claude.exe — « orienter only, pas de queue » (demande du 2026-08-21, conv-1361).
 *
 * Un message tapé PENDANT un tour partait en FILE D'ATTENTE : l'agent ne le voyait qu'au tour
 * suivant, et l'utilisateur voyait un bloc « File d’attente » au lieu d'un effet. Le comportement
 * attendu est celui de `/btw` : injection dans le tour EN COURS, sans interruption, sans file.
 *
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE :
 * un message ordinaire ('décale les icônes de 4 px', SANS `/btw`) soumis alors que `busy` est vrai.
 * Si le composer retombe sur `enqueueMessage`, `injectDirective` n'est pas appelée → rouge.
 * (L'affichage de la file a été retiré le 2026-09-17 : le repli se constate désormais au reçu.)
 */
describe('ChatView — pendant un tour, un message ordinaire ORIENTE (pas de file)', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  async function monter(injecte: ReturnType<typeof vi.fn>): Promise<{
    pilote: (event: Record<string, unknown>) => void
  }> {
    let pilote!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        injectDirective: injecte,
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    return { pilote }
  }

  async function soumettre(texte: string): Promise<void> {
    await harness!.type(texte)
    await act(async () => {
      harness!
        .textarea()
        .dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })
    await act(async () => {})
  }

  it('injecte la directive dans le tour en cours et n’ouvre aucune file', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: true })
    const { pilote } = await monter(injecte)
    // Un tour tourne (delta reçu) ⇒ `busy` est vrai pour la conversation A.
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))

    await soumettre('décale les icônes de 4 px')

    expect(injecte).toHaveBeenCalledWith('A', 'décale les icônes de 4 px')
  })

  it('injection refusée ⇒ repli en file, rien n’est perdu', async () => {
    const injecte = vi.fn().mockResolvedValue({ ok: false })
    const { pilote } = await monter(injecte)
    await act(async () => pilote({ conversationId: 'A', kind: 'delta', delta: 'je travaille' }))

    await soumettre('décale les icônes de 4 px')

    expect(injecte).toHaveBeenCalled()
    // Repli en file : plus aucun affichage, mais le texte reste visible via son reçu d'échec.
    expect(harness!.container.querySelector('.directive-receipt-status')?.textContent).toContain(
      'Échec'
    )
  })
})
