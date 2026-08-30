// @vitest-environment happy-dom
/**
 * SUPPRESSIONS DEMANDÉES (2026-08-30) : le panneau « Réflexion » et le bouton « Exporter .md »
 * ne font plus partie du chat.
 *
 * Entrée qui ferait échouer ce test si la correction était fausse : un simple masquage
 * (`display:none`, `hidden`, rendu conditionnel désactivé) laisserait les nœuds dans le DOM —
 * on interroge la PRÉSENCE des nœuds, pas leur visibilité. Idem si l'on ne retirait qu'une des
 * deux cibles : chaque assertion est indépendante.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

let harness: ChatHarness | null = null
beforeAll(installRafShim)
afterEach(async () => {
  await harness?.unmount()
  harness = null
})

describe('ChatView — cibles retirées', () => {
  it('n’expose plus le bouton Réflexion ni son panneau', async () => {
    harness = await mountChat(chatApi())
    expect(harness.container.querySelector('[data-testid="chat-thinking-toggle"]')).toBeNull()
    expect(harness.container.querySelector('[data-testid="thinking-panel"]')).toBeNull()
    expect(harness.container.textContent).not.toContain('Réflexion')
  })

  it('n’expose plus le bouton Exporter .md', async () => {
    harness = await mountChat(chatApi())
    expect(harness.container.querySelector('[data-testid="chat-export-markdown"]')).toBeNull()
    expect(harness.container.textContent).not.toContain('Exporter')
  })
})
