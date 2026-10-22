// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { COMPACT_REQUEST } from '../../../shared/context-gauge'
import { chatApi, installRafShim, mountChat, type ChatHarness } from './ChatView.harness'

/**
 * LA COMPACTION AUTOMATIQUE N'EST PLUS REFUSÉE SANS UN MOT (conv-1080, 2026-10-22).
 *
 * Elle se déclenche sur l'événement `done` dont la jauge franchit le palier critique. Or le main
 * relaie `done` PENDANT le tour et ne rend la réponse de `pilotChat` qu'après son `finally`
 * (`run-pilot-chat.ts`) ; le verrou d'envoi de la vue (`sendLocksRef`) tient jusqu'à cette réponse.
 * `send(COMPACT_REQUEST)` partait dans cet intervalle, butait sur le verrou et rendait la main sans
 * rien envoyer — alors que le fil était déjà noté « compacté » (`compactionAutoRef`) : aucune
 * nouvelle tentative avant que la jauge redescende, ce qu'elle ne fait justement pas sans résumé.
 * Même défaut que l'orientation perdue de conv-996 (`ChatView.orientation-orpheline.test.tsx`).
 */
describe('ChatView — compaction automatique et verrou d’envoi', () => {
  let harness: ChatHarness | undefined
  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
  })

  /** Un `done` qui porte la consommation d'un fil saturé : 190 k sur les 200 k de haiku = 95 %. */
  const DONE_CRITIQUE = {
    kind: 'done',
    usage: {
      inputTokens: 190_000,
      derniereEntree: 190_000,
      outputTokens: 100,
      model: 'claude-haiku-4-5',
      provider: 'claude'
    }
  }

  /** Le dernier message utilisateur de chaque appel au pilote : ce qui est parti, appel par appel. */
  const envois = (pilotChat: ReturnType<typeof vi.fn>): string[] =>
    pilotChat.mock.calls.map((appel) => {
      const messages = Array.isArray(appel[0])
        ? (appel[0] as { role: string; content?: string }[])
        : []
      return messages.filter((m) => m.role === 'user').at(-1)?.content ?? ''
    })

  it('done critique AVANT la réponse de pilotChat : la compaction part après cette réponse', async () => {
    let pilote!: (event: Record<string, unknown>) => void
    let tourEnVol = false
    let rendreLaReponse: (() => void) | undefined
    // Le premier tour attend sa réponse ; les suivants (la compaction) restent en vol.
    const pilotChat = vi.fn(() => {
      tourEnVol = true
      if (pilotChat.mock.calls.length === 1)
        return new Promise((resolve) => {
          rendreLaReponse = () => {
            tourEnVol = false
            resolve({ ok: true })
          }
        })
      return new Promise(() => {})
    })
    harness = await mountChat(
      chatApi({
        pilotChat,
        pilotChatActive: vi.fn(async () => ({ active: tourEnVol })),
        appState: vi.fn().mockResolvedValue({ activeConversationId: 'A' }),
        conversation: vi.fn().mockResolvedValue({ id: 'A', messages: [] }),
        onPilotEvent: vi.fn((listener) => {
          pilote = listener as (event: Record<string, unknown>) => void
          return vi.fn()
        })
      })
    )
    await harness.type('continue le chantier')
    await harness.click('[data-testid="composer-send"]')
    expect(pilotChat).toHaveBeenCalledTimes(1)
    const fil = String((pilotChat.mock.calls[0] as unknown[])[1])

    // Le main relaie `done` d'abord ; la vue se redessine avant la réponse de `pilotChat`.
    await act(async () => {
      pilote({ conversationId: fil, ...DONE_CRITIQUE })
      await new Promise((r) => setTimeout(r, 10))
    })
    expect(
      pilotChat,
      'rien ne part tant que le tour précédent n’a pas rendu sa réponse'
    ).toHaveBeenCalledTimes(1)

    // La compaction ne part qu'à la fin de la clôture de l'envoi : attente bornée (2 s).
    await act(async () => {
      rendreLaReponse?.()
      for (let attente = 0; attente < 200 && pilotChat.mock.calls.length < 2; attente++)
        await new Promise((r) => setTimeout(r, 10))
    })
    const tous = envois(pilotChat)
    expect(tous, 'la compaction doit partir, pas être refusée en silence').toHaveLength(2)
    expect(tous[1]).toBe(COMPACT_REQUEST)

    // Une seule fois par franchissement : rien ne la renvoie ensuite.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 50))
    })
    expect(envois(pilotChat).filter((texte) => texte === COMPACT_REQUEST)).toHaveLength(1)
  })
})
