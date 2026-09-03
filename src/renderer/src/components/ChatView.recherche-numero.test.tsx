// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * SYMPTOME rapporte le 2026-09-03 : « quand je tape 171 dans la recherche, faudrait que le nom soit
 * ecrit et 171 surligne ». La ligne masquait le bloc `conv-meta` des qu'un terme etait tape : le
 * NUMERO — la seule information qui prouve qu'on regarde la bonne conversation — disparaissait
 * exactement au moment ou on le cherchait.
 */
describe('ChatView — recherche par numero', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('affiche le numero et le surligne quand il correspond au terme cherche', async () => {
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([conversation('conv-171'), conversation('conv-12')])
      })
    )
    const champ = harness.container.querySelector<HTMLInputElement>(
      'input[aria-label="Rechercher dans les conversations"]'
    )
    expect(champ).not.toBeNull()
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value'
      )?.set
      setter?.call(champ, '171')
      champ!.dispatchEvent(new Event('input', { bubbles: true }))
    })

    // On vise le bloc `conv-meta` LUI-MEME : le titre de test contient deja l'identifiant, donc
    // chercher « conv-171 » dans toute la vue passerait meme sans le correctif.
    const meta = harness.container.querySelector('.conv-meta')
    expect(meta).not.toBeNull()
    expect(meta?.textContent).toContain('conv-171')
    const surlignes = Array.from(meta!.querySelectorAll('mark.conv-highlight')).map(
      (m) => m.textContent
    )
    expect(surlignes).toContain('171')
  })
})
