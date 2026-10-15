import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { flattenChatParts } from '../../shared/chat-turn'
import { ConversationStore } from './conversations'
import {
  attendreEcrituresConversations,
  conversationJournalPath,
  loadConversations,
  persistConversations,
  saveConversations
} from './conversations-disk'

/**
 * LE TEXTE D'UN MESSAGE À PARTIES N'EST ÉCRIT QU'UNE FOIS (mesure du 2026-10-14 : 18,9 Mo de
 * `content` identiques à `flattenChatParts(parts)` dans un `conversations.json` de 75,7 Mo).
 */
const dir = mkdtempSync(join(tmpdir(), 'aos-contenu-derive-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** Un tour réel : texte, action réussie, fin — `content` est alors dérivé des parties. */
function tourAvecParties(
  store: ConversationStore,
  id: string,
  turnId: string,
  texte: string
): void {
  store.beginTurn(id, { content: 'Go' }, { turnId })
  store.applyTurnEvent(id, turnId, { kind: 'delta', streamId: '0:0', text: texte })
  store.applyTurnEvent(id, turnId, { kind: 'command', actionId: 'a1', name: 'get_state', args: {} })
  store.applyTurnEvent(id, turnId, { kind: 'result', actionId: 'a1', name: 'get_state', ok: true })
  store.applyTurnEvent(id, turnId, { kind: 'done' })
}

type MessageDisque = { role: string; content: string; parts?: unknown[] }
const messagesSurDisque = (p: string): MessageDisque[] =>
  (JSON.parse(readFileSync(p, 'utf8')) as Array<{ messages: MessageDisque[] }>).flatMap(
    (c) => c.messages
  )

describe('content dérivé des parties : écrit vide, recalculé à la lecture', () => {
  it('le snapshot n’écrit pas deux fois le texte, et la relecture le rend à l’identique', () => {
    const p = join(dir, 'snapshot.json')
    const a = new ConversationStore(() => 1000)
    const c = a.create({ title: 'Doublon', provider: 'claude' })
    tourAvecParties(a, c.id, 'turn-1', 'Une réponse assez longue pour peser.')
    const enMemoire = a.get(c.id)!.messages[1]
    expect(enMemoire.content).toBe(flattenChatParts(enMemoire.parts!))
    expect(enMemoire.content).toContain('Une réponse assez longue')

    saveConversations(a.list(), p)

    const disque = messagesSurDisque(p).find((m) => m.role === 'assistant')!
    // Sur le disque : le champ EXISTE (une version précédente l'exige) mais il est vide.
    expect(disque.content).toBe('')
    expect(disque.parts?.length).toBeGreaterThan(0)
    // La mémoire n'a pas été touchée par l'écriture.
    expect(a.get(c.id)!.messages[1].content).toBe(enMemoire.content)

    const relu = loadConversations(p).find((x) => x.id === c.id)!
    expect(relu.messages[1].content).toBe(enMemoire.content)
    // Le message utilisateur, sans parties, garde son texte écrit.
    expect(messagesSurDisque(p).find((m) => m.role === 'user')?.content).toBe('Go')
  })

  it('un content qui DIFFÈRE de sa dérivation reste écrit tel quel — rien ne se perd', () => {
    const p = join(dir, 'divergent.json')
    writeFileSync(
      p,
      JSON.stringify([
        {
          schemaVersion: 3,
          id: 'conv-1',
          title: 'Ancienne',
          provider: 'claude',
          createdAt: 1,
          updatedAt: 2,
          messages: [
            {
              role: 'assistant',
              content: 'texte historique différent',
              ts: 1,
              messageId: 'message-conv-1-1',
              status: 'completed',
              parts: [{ kind: 'text', text: 'autre chose' }]
            }
          ]
        }
      ]),
      'utf8'
    )
    const relu = loadConversations(p)
    saveConversations(relu, p)
    expect(messagesSurDisque(p)[0].content).toBe('texte historique différent')
    expect(loadConversations(p)[0].messages[0].content).toBe('texte historique différent')
  })

  it('le journal (upsert, ajout de messages) suit la même règle et se relit à l’identique', async () => {
    const p = join(dir, 'journal.json')
    const a = new ConversationStore(() => 1000)
    persistConversations(a, p)
    const c = a.create({ title: 'Journalisée', provider: 'claude' })
    tourAvecParties(a, c.id, 'turn-j', 'Réponse journalisée.')
    a.rename(c.id, 'Journalisée renommée') // upsert complet dans le journal
    await attendreEcrituresConversations()

    const lignes = readFileSync(conversationJournalPath(p), 'utf8').trim().split('\n')
    const upserts = lignes
      .map(
        (ligne) => JSON.parse(ligne) as { op: string; conversation?: { messages: MessageDisque[] } }
      )
      .filter((r) => r.op === 'upsert' && r.conversation)
    const dernier = upserts.at(-1)!.conversation!.messages.find((m) => m.role === 'assistant')!
    expect(dernier.content).toBe('')

    const attendu = a.get(c.id)!.messages[1].content
    const b = new ConversationStore(() => 2000)
    persistConversations(b, p)
    expect(b.get(c.id)?.title).toBe('Journalisée renommée')
    expect(b.get(c.id)?.messages[1].content).toBe(attendu)
    expect(attendu).toContain('Réponse journalisée.')
  })
})
