import { describe, expect, it, vi } from 'vitest'
import { dirname, join } from 'node:path'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { cheminJournalMessagesFils } from './messages-entre-fils-app'
import { confReservationFichiers } from './providers/claude'
import type { Message, SendOptions, SendResult } from './providers/types'
import { NOM_JOURNAL_MESSAGES_FILS } from '../shared/messages-entre-fils'

/*
 * conv-1139 : les messages d'autres fils arrivent dans le tour du DESTINATAIRE, en tête, par le bus
 * (`messagesDesFilsPourTour`). Entrée qui ferait échouer ce banc si le maillon manquait : un tour de
 * conv-B dont le message envoyé au modèle IA ne porte pas le code déposé pour conv-B.
 */
const CLOTURE = '✅ Fait.\n📍 Maintenant : vert.\n⏳ Reste à faire : rien.\n👉 Recommandé : rien.'

function pilot(bloc: string) {
  const envoyes: string[] = []
  const registry = {
    send: vi.fn(async (_p: string, m: Message[], _o: SendOptions): Promise<SendResult> => {
      envoyes.push(m.map((x) => x.content).join('\n'))
      return { text: CLOTURE, sessionId: 'sess' } as SendResult
    }),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' }))
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const messagesDesFilsPourTour = vi.fn((_id?: string) => bloc)
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn(async () => ({ ok: true })),
    messagesDesFilsPourTour
  }
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    p: new AgentPilot(registry as any, roles as any, bus as any),
    envoyes,
    messagesDesFilsPourTour,
    onEvent: (e: PilotEvent) => void e
  }
}

describe('le tour du destinataire reçoit les messages d’autres fils', () => {
  it('le bloc du bus part dans le message envoyé au modèle IA, demandé pour CE fil', async () => {
    const { p, envoyes, messagesDesFilsPourTour, onEvent } = pilot(
      "MESSAGES D'AUTRES FILS DU MÊME DÉPÔT (nature « ordre » est du travail à faire) :\n- msg-1 · de conv-A : CODE-7f3"
    )
    await p.chat([{ role: 'user', content: 'continue' }], onEvent, undefined, 4, 'conv-B')
    expect(messagesDesFilsPourTour).toHaveBeenCalledWith('conv-B')
    expect(envoyes[0]).toContain('CODE-7f3')
  })

  it('jumeau — bloc vide : rien d’ajouté', async () => {
    const { p, envoyes, onEvent } = pilot('')
    await p.chat([{ role: 'user', content: 'continue' }], onEvent, undefined, 4, 'conv-B')
    expect(envoyes[0]).not.toContain("MESSAGES D'AUTRES FILS")
  })
})

describe('le contrôle des agents et l’app lisent le MÊME journal', () => {
  it('à côté du registre des réservations que reservation.json donne au contrôle', () => {
    const conf = confReservationFichiers({ conversationId: 'conv-B' }, 'D:/donnees')
    expect(join(dirname(conf?.registre ?? ''), NOM_JOURNAL_MESSAGES_FILS)).toBe(
      cheminJournalMessagesFils('D:/donnees')
    )
  })
})
