// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, conversation, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * DEMANDE DU 2026-10-10 (conv-158) : « la boule est trop grosse […] elle devrait matcher le state
 * comme la pastille de conv », puis « et parfois le spinner quand la conv bosse ».
 *
 * La boule rose de 26 px a gauche du titre ne disait rien de la conversation. Variante retenue :
 * « Jumeau » — la MEME case de 18 px que la liste des fils, avec la perle de l'etat de la
 * conversation ouverte, et le <Spinner/> de 18 px quand elle travaille, posee au debut de la ligne
 * d'infos (« claude · Opus… »).
 */
describe('ChatView — la perle de l’en-tête suit l’état de la conversation ouverte', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('perle d’état au début de la ligne d’infos, puis spinner quand la conversation travaille', async () => {
    const terminee = {
      ...conversation('conv-7', [
        { role: 'user', content: 'bonjour' },
        { role: 'assistant', content: 'salut' }
      ]),
      messageCount: 2,
      lastMessageRole: 'assistant',
      lastAssistantStatus: 'completed'
    }
    let pilote!: (event: Record<string, unknown>) => void
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([terminee]),
        conversation: vi.fn().mockResolvedValue(terminee),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await harness.click('.conv-pick')

    // L'ancienne boule a disparu.
    expect(harness.container.querySelector('.chat-head-signal')).toBeNull()

    // La case est le PREMIER element de la ligne d'infos, et porte l'etat « à jour ».
    const ligne = harness.container.querySelector('[data-testid="chat-runtime-identity"]')
    const caseEtat = ligne?.firstElementChild
    expect(caseEtat?.getAttribute('data-testid')).toBe('chat-runtime-etat')
    expect(caseEtat?.classList.contains('conv-state-slot')).toBe(true)
    const perle = caseEtat?.querySelector('.conversation-state')
    expect(perle?.getAttribute('data-conversation-state')).toBe('completed')
    expect(perle?.getAttribute('title')).toContain('À jour')

    // Un tour demarre sur cette conversation : la perle laisse sa place au spinner de la liste.
    await act(async () => pilote({ conversationId: 'conv-7', kind: 'delta', delta: 'je travaille' }))
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20))
    })
    const enCours = harness.container
      .querySelector('[data-testid="chat-runtime-etat"]')
      ?.querySelector('.conversation-state')
    expect(enCours?.getAttribute('data-conversation-state')).toBe('running')
    expect(enCours?.classList.contains('aw-atom')).toBe(true)
  })
})
