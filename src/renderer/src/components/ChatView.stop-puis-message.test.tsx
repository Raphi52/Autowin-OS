// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * DEFAUT VECU (03/09) : « quand j'appuie sur stop et que j'ecris dans la foulee, le message ne
 * lance pas de tour ». Stop arme un gel one-shot du drain de file (`stoppedQueueDrain`) pour ne pas
 * relancer automatiquement ce qui restait en file. Mais le message tape JUSTE APRES tombe en file
 * (le tour n'est pas encore retombe, l'injection echoue) et se fait avaler par ce meme gel : rien
 * ne part. Un texte tape A LA MAIN apres le Stop est un geste explicite : il leve le gel.
 */
describe('ChatView — message tape juste apres un Stop', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('part bien en tour une fois le tour precedent termine', async () => {
    let finirLeTour: (() => void) | undefined
    /*
     * Le processus principal SIMULE dit la verite : un tour vit tant que sa promesse n'est pas
     * revenue, et plus apres. Depuis f128d0f3 (2026-09-23, conv-809), le renderer ne clot un tour
     * qu'apres avoir demande a `pilotChatActive` s'il vit encore ; un faux qui repondait « actif »
     * POUR TOUJOURS gardait donc le premier tour ouvert a jamais, la file ne partait plus, et ce
     * test rougissait sans que Stop ait regresse (conv-770, 2026-09-28).
     */
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
        // Le tour est en cours d'annulation : plus rien n'est injectable.
        injectDirective: vi.fn().mockResolvedValue({ ok: false }),
        cancelPilotChat: vi.fn().mockResolvedValue({ ok: true })
      })
    )
    await harness.type('premier message')
    await harness.click('[data-testid="composer-send"]')
    expect(pilotChat).toHaveBeenCalledTimes(1)

    await harness.click('[data-testid="composer-stop"]')
    await harness.type('et maintenant fais ceci')
    await harness.click('[data-testid="composer-send"]')

    await act(async () => {
      finirLeTour?.()
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(pilotChat).toHaveBeenCalledTimes(2)
    // Et c'est bien le texte tape APRES le Stop qui part, pas une relance de l'ancien.
    expect(JSON.stringify((pilotChat.mock.calls[1] as unknown[])[0])).toContain(
      'et maintenant fais ceci'
    )
  }, 20_000)
})
