// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * DEFAUT VECU (31/08) : « je ne peux pas cliquer sur stop, il est dans un etat ou il y a ecrit
 * Arret dessus ». `cancelPilotChat` repond `{ ok: true }` — l'annulation A ete prise en charge —
 * mais le tour survit (pilote bloque dans une orchestration, sur laquelle l'abort n'a pas prise).
 * `interrupting` n'etait alors relache par PERSONNE : le bouton restait « Arret… » et DESACTIVE
 * pour toujours. On borne ce libelle : passe le delai, la main revient a l'utilisateur.
 */
describe('ChatView — Stop fige sur « Arrêt… »', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    vi.useRealTimers()
  })

  it('rend la main sur le bouton Stop quand le tour survit a son annulation', async () => {
    const annuler = vi.fn().mockResolvedValue({ ok: true })
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
        // Le tour ne retombe JAMAIS : c'est exactement l'orchestration insensible a l'abort.
        pilotChat: vi.fn(() => new Promise(() => {})),
        cancelPilotChat: annuler
      })
    )
    await harness.type('lance quelque chose')
    await harness.click('[data-testid="composer-send"]')
    const stop = (): HTMLButtonElement | null =>
      harness!.container.querySelector('[data-testid="composer-stop"]')
    expect(stop()).not.toBeNull()

    await harness.click('[data-testid="composer-stop"]')
    await act(async () => {
      await Promise.resolve()
    })
    expect(annuler).toHaveBeenCalled()
    // Etat immediat, legitime : l'annulation est partie.
    expect(stop()?.textContent).toContain('Arrêt')
    expect(stop()?.disabled).toBe(true)

    // Le tour survit. Passe le rearmement, le bouton redevient CLIQUABLE (second Stop possible).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10_200))
    })
    expect(stop()?.disabled).toBe(false)
    expect(stop()?.textContent).toContain('Stop')
  }, 20_000)
})
