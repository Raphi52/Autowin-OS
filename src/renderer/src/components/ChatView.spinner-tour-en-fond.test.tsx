// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * DEMANDE (conv-914, 2026-10-13) : « si cette conv est en train de bosser encore faut que j'ai un
 * spinner sur la conv ».
 *
 * VÉCU : deux runs rattachés au redémarrage travaillaient encore dans conv-914, mais un tour de chat
 * plus récent (« reprend ») était terminé. Le résumé ne servait que le statut du DERNIER tour
 * (`completed`) et l'écran n'avait aucun tour ouvert : pas de spinner sur la ligne.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST SI LA CORRECTION EST FAUSSE : une ligne qui ignore
 * `hasStreamingTurn` (pas de spinner), ou un spinner qui ne s'éteint pas quand la liste rechargée
 * dit que plus rien ne tourne (spinner fantôme).
 */

/** Résumé IPC tel que le sert `listSummaries` : sans messages, statut du dernier tour seulement. */
const resume = (id: string, enCours: boolean): Record<string, unknown> => ({
  id,
  title: `Conversation ${id}`,
  provider: 'codex',
  updatedAt: 1,
  messageCount: 4,
  lastMessageRole: 'assistant',
  lastAssistantStatus: 'completed',
  ...(enCours ? { hasStreamingTurn: true } : {})
})

const etatDeLaLigne = (container: HTMLElement, titre: string): string | null | undefined => {
  const ligne = [...container.querySelectorAll('.conv-item')].find((el) =>
    el.textContent?.includes(titre)
  )
  return ligne
    ?.querySelector('.conv-state-slot [data-conversation-state]')
    ?.getAttribute('data-conversation-state')
}

describe('ChatView — spinner d’un tour qui tourne encore plus haut dans le fil', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  it('allume le spinner de la ligne, puis l’éteint quand la liste rechargée dit que c’est fini', async () => {
    let envoyer: ((e: Record<string, unknown>) => void) | undefined
    const conversations = vi.fn().mockResolvedValue([resume('A', true), resume('B', false)])
    harness = await mountChat(
      chatApi({
        conversations,
        onAppEvent: vi.fn((rappel: (e: Record<string, unknown>) => void) => {
          envoyer = rappel
          return vi.fn()
        })
      })
    )
    await act(async () => {
      await Promise.resolve()
    })

    expect(etatDeLaLigne(harness.container, 'Conversation A')).toBe('running')
    // Jumeau : même fil, même dernier tour terminé, rien en cours → pas de spinner (la pastille
    // « terminé », lue ou non lue selon que le fil a été ouvert).
    expect(etatDeLaLigne(harness.container, 'Conversation B')).toMatch(/^(completed|unread)$/)

    // Le run se ferme côté main : `onClosed` envoie `refresh/conversations`, la liste se recharge.
    conversations.mockResolvedValue([resume('A', false), resume('B', false)])
    expect(envoyer, 'ChatView n’écoute pas les événements du main').toBeTypeOf('function')
    await act(async () => {
      envoyer!({ type: 'refresh', scope: 'conversations' })
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(etatDeLaLigne(harness.container, 'Conversation A')).toMatch(/^(completed|unread)$/)
  })
})
