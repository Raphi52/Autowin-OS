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
    const pilotChat = vi.fn(() => {
      if (pilotChat.mock.calls.length === 1)
        return new Promise((resolve) => {
          finirLeTour = () => resolve({ ok: true, messages: [] })
        })
      return Promise.resolve({ ok: true, messages: [] })
    })
    harness = await mountChat(
      chatApi({
        capabilityControls: vi.fn().mockResolvedValue([]),
        pilotChatActive: vi.fn().mockResolvedValue({ active: true }),
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
  }, 20_000)
})
