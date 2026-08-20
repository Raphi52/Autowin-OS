// @vitest-environment happy-dom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LE SYMPTOME, rapporte le 20/08 : « souvent tu me parles de conv-0000 mais in app je sais pas a
 * quoi ca correspond ».
 *
 * L'agent designe les conversations par leur identifiant, et l'en-tete du chat n'affichait nulle
 * part lequel on regarde. La place etait occupee par « interface prete » — un libelle qui n'apprend
 * rien, puisqu'une interface qu'on lit est affichee.
 */
describe('ChatView — l’en-tête nomme la conversation qu’on regarde', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('affiche l’identifiant de la conversation active, et non « interface prête »', async () => {
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('conv-42')]),
        conversation: vi.fn().mockResolvedValue({ id: 'conv-42', messages: [] })
      })
    )

    const pastille = harness.container.querySelector('[data-testid="chat-runtime-conv"]')
    expect(pastille).not.toBeNull()
    expect(pastille?.textContent).toContain('conv-42')

    // L'ancien libelle a disparu de l'en-tete : c'est la place qu'on a recuperee.
    expect(harness.container.textContent).not.toContain('interface prête')

    // L'infobulle DIT ce que l'identifiant est — sans elle, « conv-42 » reste une enigme de plus.
    expect(pastille?.getAttribute('title')).toContain('conv-42')
    expect(pastille?.getAttribute('title')).toContain('conversation')
  })
})
