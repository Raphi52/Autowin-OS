// @vitest-environment happy-dom
/**
 * Le panneau « Réflexion » s'ouvre depuis l'entête du chat, à droite du fil.
 * Entrée qui ferait échouer une correction fausse : le panneau NE doit PAS être là avant le clic
 * (un rendu inconditionnel passerait un test qui ne vérifie que l'après-clic).
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

let harness: ChatHarness | null = null
beforeAll(installRafShim)
afterEach(async () => {
  await harness?.unmount()
  harness = null
})

describe('ChatView — panneau Réflexion', () => {
  it('n’affiche le panneau qu’après clic sur le bouton dédié', async () => {
    harness = await mountChat(chatApi())
    expect(harness.container.querySelector('[data-testid="thinking-panel"]')).toBeNull()
    await harness.click('[data-testid="chat-thinking-toggle"]')
    expect(harness.container.querySelector('[data-testid="thinking-panel"]')).not.toBeNull()
    await harness.click('[data-testid="chat-thinking-toggle"]')
    expect(harness.container.querySelector('[data-testid="thinking-panel"]')).toBeNull()
  })
})
