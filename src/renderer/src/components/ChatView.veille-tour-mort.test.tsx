// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LE SYMPTOME EXACT, rapporte le 20/08 : « la conversation affiche une action en cours quand le
 * workflow est arrete ».
 *
 * La sonde d'autorite (`pilotChatActive`) existait deja, mais elle ne tirait QU'A L'OUVERTURE d'une
 * conversation. Sur la conversation DEJA OUVERTE — celle qu'on regarde — un tour qui meurt sans
 * rendre son evenement de fin (workflow arrete, main redemarre, IPC perdu) n'etait jamais reconcilie :
 * le badge tournait jusqu'a un changement de conversation ou un redemarrage de l'app.
 */
describe('ChatView — veille sur le tour vivant', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  // rAF/cAF sont SHIMES par le harnais sur des proprietes non assignables : les faire truquer par
  // vitest jette. On ne truque donc que les timers, sur lesquels le shim s'appuie de toute facon.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] })
  })
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    vi.useRealTimers()
  })

  it('un tour mort côté main est CLOS sans changer de conversation', async () => {
    const sonde = vi.fn().mockResolvedValue({ active: false })
    harness = await mountChat(
      chatApi({
        pilotChatActive: sonde,
        // Le tour ne rend JAMAIS la main : c'est l'etat dans lequel l'utilisateur reste coince.
        pilotChat: vi.fn(() => new Promise(() => {}))
      })
    )
    await harness.type('lance quelque chose')
    await harness.click('[data-testid="composer-send"]')
    const stop = (): Element | null =>
      harness!.container.querySelector('[data-testid="composer-stop"]')
    expect(stop()).not.toBeNull()

    // La veille sonde l'autorite, deux fois de suite pour ne pas tuer un tour qui demarre.
    for (let tick = 0; tick < 3; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
    }
    expect(sonde).toHaveBeenCalled()
    expect(stop()).toBeNull()
    expect(harness.container.textContent).not.toContain('action en cours')
  })

  it('un tour VIVANT n’est jamais coupé par la veille', async () => {
    harness = await mountChat(
      chatApi({
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
        pilotChat: vi.fn(() => new Promise(() => {}))
      })
    )
    await harness.type('lance quelque chose')
    await harness.click('[data-testid="composer-send"]')
    for (let tick = 0; tick < 4; tick += 1) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
    }
    expect(harness.container.querySelector('[data-testid="composer-stop"]')).not.toBeNull()
  })
})
