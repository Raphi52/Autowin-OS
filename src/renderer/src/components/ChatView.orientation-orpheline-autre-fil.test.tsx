// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * conv-1241 (2026-10-28, capture jointe au tour 6e6212f1-6fad-4dc5-aff0-bbfea50db4f7) : le bandeau
 * « 1 orientation(s) arrivée(s) après la fin du tour : remise(s) dans la zone de saisie (Stop
 * demandé) » s'affichait au-dessus de conv-1240, dont le tour tournait encore. Il venait de conv-1227
 * (orientation saisie ts 1793225339296, Stop du tour 68a6d0e9 à 22:09:11). Le bandeau est commun à
 * toute la vue et survit au changement de fil : sans le nom du fil, il se lit comme concernant
 * celui qu'on regarde.
 */
describe('ChatView — orientation rendue : le bandeau nomme son fil', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('une orientation rendue pour un AUTRE fil dit lequel', async () => {
    let app!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([
          { id: 'A', title: 'Ligne de lecture retenue', createdAt: 1, updatedAt: 2, messages: [] },
          { id: 'B', title: 'Personnifier la mascotte', createdAt: 1, updatedAt: 1, messages: [] }
        ]),
        appState: vi.fn().mockResolvedValue({ activeConversationId: 'A' }),
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onAppEvent: vi.fn((listener) => {
          app = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await act(async () =>
      app({ type: 'directives-orphelines', convId: 'B', textes: ['pk je la vois pas?'] })
    )
    await act(async () => {})
    const texte = harness.container.textContent ?? ''
    expect(texte).toContain('après la fin du tour')
    expect(texte).toContain('« Personnifier la mascotte »')
  })
})
