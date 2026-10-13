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
 * TOUR REPRIS APRÈS REDÉMARRAGE : l'écran l'ADOPTE au lieu de croire le fil libre.
 *
 * Vécu le 2026-10-11 (conv-260) : le main redémarre à 22:43 pendant un tour lancé à 22:29. Le CLI
 * survit et le main le reprend, mais n'émet aucun événement pilote pendant l'attente. L'écran ne
 * passait un fil en « occupé » que sur un tel événement : bulle figée, aucun bouton Stop, et le
 * message suivant lançait un SECOND agent sur la même session.
 */
describe('ChatView — adopter un tour repris après redémarrage', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  const bulleFigee = {
    role: 'assistant' as const,
    status: 'streaming',
    parts: [{ kind: 'text', text: 'Je repars de zéro sur les deux fronts.' }]
  }
  const stop = (): Element | null =>
    harness!.container.querySelector('[data-testid="composer-stop"]')

  it('le fil dont le tour est vivant côté main passe OCCUPÉ à l’ouverture : Stop apparaît', async () => {
    const sonde = vi.fn().mockResolvedValue({ active: true })
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [bulleFigee])]),
        pilotChatActive: sonde
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(sonde).toHaveBeenCalledWith('A')
    expect(stop()).not.toBeNull()
  })

  it('un message tapé pendant la reprise part en ORIENTATION, jamais en second tour', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const injectDirective = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [bulleFigee])]),
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
        pilotChat,
        injectDirective
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    await harness.type('les reprises de fil marchent pas bien')
    await harness.click('[data-testid="composer-send"]')
    await act(async () => {
      await Promise.resolve()
    })
    expect(pilotChat).not.toHaveBeenCalled()
    expect(injectDirective).toHaveBeenCalledWith('A', 'les reprises de fil marchent pas bien')
  })

  /*
   * UN RÉCAPITULATIF DE REPRISE POSÉ APRÈS LE TOUR VIVANT (conv-913, 2026-10-13). Au redémarrage de
   * 10:26:39, le main a rattaché l'orchestration du fil et AJOUTÉ en bas un message « Reprise du fil… »
   * sans statut, donc relu comme terminé. L'écran ne sondait que si la DERNIÈRE bulle assistant était
   * non close : il ne demandait rien, croyait le fil libre, et « reprend » (10:28:29 puis 10:28:59)
   * partait en message normal — refusé par le main, dont le tour « finis » (CLI 11600) tournait encore.
   */
  const recapTermine = {
    role: 'assistant' as const,
    content:
      "Reprise du fil — l'agent a continué de travailler pendant que l'application était fermée, et il travaille encore."
  }

  it('un récapitulatif terminé posé APRÈS la bulle vivante n’empêche pas la sonde : Stop apparaît', async () => {
    const sonde = vi.fn().mockResolvedValue({ active: true })
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A', [bulleFigee, recapTermine])]),
        pilotChatActive: sonde
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(sonde).toHaveBeenCalledWith('A')
    expect(stop()).not.toBeNull()
  })

  it('avec ce récapitulatif en bas, un message tapé part en ORIENTATION', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    const injectDirective = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        conversations: vi
          .fn()
          .mockResolvedValue([conversation('A', [bulleFigee, recapTermine])]),
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
        pilotChat,
        injectDirective
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    await harness.type('reprend')
    await harness.click('[data-testid="composer-send"]')
    await act(async () => {
      await Promise.resolve()
    })
    expect(pilotChat).not.toHaveBeenCalled()
    expect(injectDirective).toHaveBeenCalledWith('A', 'reprend')
  })

  it('un fil dont TOUTES les bulles sont closes n’interroge pas le main', async () => {
    const sonde = vi.fn().mockResolvedValue({ active: true })
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [recapTermine])]),
        pilotChatActive: sonde
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(sonde).not.toHaveBeenCalled()
    expect(stop()).toBeNull()
  })

  it('un tour MORT côté main reste clos comme avant : pas de Stop, l’envoi part en tour normal', async () => {
    const pilotChat = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('A', [bulleFigee])]),
        pilotChatActive: vi.fn().mockResolvedValue({ active: false }),
        pilotChat
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(stop()).toBeNull()
    await harness.type('nouvelle demande')
    await harness.click('[data-testid="composer-send"]')
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    expect(pilotChat).toHaveBeenCalled()
  })
})
