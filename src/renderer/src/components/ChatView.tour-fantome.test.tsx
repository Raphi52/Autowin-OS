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
 * TOUR FANTOME : le renderer se croit occupe, le main dit que rien ne tourne.
 *
 * Vecu par l'utilisateur le 20/08 : « l'app m'ecrit 1 action en cours quand plus rien ne se passe »,
 * panneau Sous-agents vide, messages tapes mis EN FILE au lieu d'etre envoyes, bouton Stop inutile.
 * La reponse `{ ok: false }` de l'annulation etait la preuve qu'aucun tour n'existait — elle etait
 * jetee.
 */
describe('ChatView — sortir d’un tour fantôme', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  const messageEnVol = {
    role: 'assistant' as const,
    status: 'streaming',
    parts: [
      { kind: 'action', name: 'orchestrate', args: { task: 'x' } },
      { kind: 'text', text: 'travail en cours' }
    ]
  }

  it('à l’ouverture, un tour mort côté main est CLOS — l’action cesse de se lire « en cours »', async () => {
    const sonde = vi.fn().mockResolvedValue({ active: false })
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        conversations: vi.fn().mockResolvedValue([conversation('A', [messageEnVol])]),
        pilotChatActive: sonde
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(sonde).toHaveBeenCalledWith('A')
    // L'action sans issue est marquée interrompue : plus aucune surface ne la lit « en cours ».
    expect(harness.container.textContent).not.toContain('action en cours')
  })

  it('un tour RÉELLEMENT en vol n’est pas touché — mieux vaut prudent que mort à tort', async () => {
    const sonde = vi.fn().mockResolvedValue({ active: true })
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        conversations: vi.fn().mockResolvedValue([conversation('A', [messageEnVol])]),
        pilotChatActive: sonde
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    expect(sonde).toHaveBeenCalledWith('A')
  })

  it('la sonde en échec ne change RIEN : on ne déclare pas mort ce qu’on n’a pas pu vérifier', async () => {
    const sonde = vi.fn().mockRejectedValue(new Error('IPC coupé'))
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        conversations: vi.fn().mockResolvedValue([conversation('A', [messageEnVol])]),
        pilotChatActive: sonde
      })
    )
    await act(async () => {
      await Promise.resolve()
    })
    // Aucun rejet non géré, et l'app tient debout.
    expect(harness.container.textContent).toBeTruthy()
  })

  it('Stop sur un tour fantôme REND LA MAIN : le bouton repasse d’« Mettre en file » à « Envoyer »', async () => {
    // `{ ok: false }` = le main n'avait AUCUN tour a couper. C'est la preuve, pas un echec.
    const annuler = vi.fn().mockResolvedValue({ ok: false })
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
        // Un tour REELLEMENT en vol : l'appel ne retombe pas, donc `busy` reste arme — c'est l'etat
        // dans lequel l'utilisateur s'est retrouve coince.
        pilotChat: vi.fn(() => new Promise(() => {})),
        cancelPilotChat: annuler
      })
    )
    // Un tour demarre : la conversation devient occupee et le composer met en file.
    await harness.type('lance quelque chose')
    await harness.click('[data-testid="composer-send"]')
    // Le bouton Stop n'existe QUE pendant un tour : sa presence est le marqueur fiable de `busy`
    // (le libelle d'envoi, lui, peut basculer sur « ↻ Reprendre » et ne discrimine donc rien).
    const stop = (): Element | null =>
      harness!.container.querySelector('[data-testid="composer-stop"]')
    expect(stop()).not.toBeNull()

    // Stop : le main repond qu'il n'y avait rien. Avant le correctif, `busy` restait arme pour
    // toujours — messages en file, bouton Stop inutile, conversation definitivement muette.
    await harness.click('[data-testid="composer-stop"]')
    await act(async () => {
      await Promise.resolve()
    })
    expect(annuler).toHaveBeenCalled()
    expect(stop()).toBeNull()
  })
})
