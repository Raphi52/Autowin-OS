// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * conv-61, 2026-10-02 : « ca a envoyé 2 fois : au lieu du code je veux un nom et prénom ».
 * Saisie `ts 1790960554261` (voie orientation) pendant le tour 11229cd2-86e2-4b51-a445-92d879492ef9,
 * puis Stop (tour annule a 1790960577444). L'orientation non lue revient APRES le Stop, donc apres
 * que la file a ete rendue au composer : elle restait dans une file INVISIBLE. L'utilisateur la
 * corrige (`ts 1790960608859`), et pourtant elle part seule a `ts 1790960868134` (tour
 * b9f32631-7e2f-4c0f-b2c0-c90a4a1f057b). Apres un Stop, elle doit revenir dans le composer.
 */
describe('ChatView — orientation orpheline arrivee apres un Stop', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('revient dans le composer et ne part jamais seule', async () => {
    let app!: (event: Record<string, unknown>) => void
    let finirLeTour: (() => void) | undefined
    let tourEnVol = false
    const pilotChat = vi.fn(() => {
      tourEnVol = true
      if (pilotChat.mock.calls.length === 1)
        return new Promise((resolve) => {
          finirLeTour = () => {
            tourEnVol = false
            resolve({ ok: true, messages: [] })
          }
        })
      tourEnVol = false
      return Promise.resolve({ ok: true, messages: [] })
    })
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        pilotChatActive: vi.fn(async () => ({ active: tourEnVol })),
        pilotChat,
        injectDirective: vi.fn().mockResolvedValue({ ok: false }),
        cancelPilotChat: vi.fn().mockResolvedValue({ ok: true }),
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await harness.type('reprend')
    await harness.click('[data-testid="composer-send"]')
    await harness.click('[data-testid="composer-stop"]')
    await act(async () => {
      finirLeTour?.()
      await new Promise((r) => setTimeout(r, 50))
    })
    // Le main rend l orientation non lue APRES la fin du tour coupe.
    await act(async () => {
      app({ type: 'directives-orphelines', convId: String((pilotChat.mock.calls[0] as unknown[])[1]), textes: ['au lieu du code je veux un nom et prénom'] })
      await new Promise((r) => setTimeout(r, 50))
    })
    // Le texte est rendu au composer, visible : l utilisateur decide.
    expect(harness.container.querySelector("textarea")?.value ?? "").toContain("au lieu du code")
    // Un tour plus tard (fin d'un autre tour => busy→false), rien ne doit partir seul.
    await harness.type('enfin non je veux le code + nom')
    await harness.click('[data-testid="composer-send"]')
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    const envois = pilotChat.mock.calls.map((c) => JSON.stringify(c))
    expect(envois.filter((e) => e.includes('au lieu du code je veux un nom et prénom') && !e.includes('enfin non'))).toHaveLength(0)
  }, 20_000)
})

