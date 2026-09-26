import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'
import { conversationJournalPath, loadConversations } from './conversations-disk'

/**
 * conv-717 (2026-09-19) : « quand j'ai écrit fais tout ça a effacé ton message précédent ».
 * La réponse à une consigne écrite pendant un tour vit dans le message assistant AU-DESSUS d'elle.
 * La consigne doit donc porter le point où elle a coupé la réponse, pour que l'écran l'y remette.
 */
const dir = mkdtempSync(join(tmpdir(), 'aos-coupe-reponse-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('consigne écrite pendant un tour : point de coupure', () => {
  it('le store note combien de parts la réponse en cours avait déjà', () => {
    const store = new ConversationStore(() => 1000)
    const conv = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'liste 100 inconvénients' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Voici 100.' })
    const apres = store.append(conv.id, {
      role: 'user',
      content: 'quoi eliminer ?',
      orientation: true,
      avantLaReponseEnCours: true
    })
    expect(apres.messages.at(-1)).toMatchObject({ orientation: true, coupeLaReponse: 1 })
  })

  it('le rejeu du journal historique (sans marqueur) retrouve la coupure — forme réelle conv-717', () => {
    const p = join(dir, 'conversations.json')
    writeFileSync(p, '[]', 'utf8')
    const rec = (o: object): string =>
      JSON.stringify({ schema: 'autowin.conversation-change/v1', id: 'conv-717', ...o })
    const lignes = [
      JSON.stringify({
        schema: 'autowin.conversation-change/v1',
        op: 'upsert',
        conversation: {
          schemaVersion: 3,
          id: 'conv-717',
          title: 'x',
          provider: 'claude',
          messages: [],
          createdAt: 1,
          updatedAt: 1
        }
      }),
      rec({
        op: 'append-messages',
        updatedAt: 2,
        messages: [
          { messageId: 'm1', role: 'user', content: 'liste 100', ts: 2 },
          {
            messageId: 'm2',
            role: 'assistant',
            content: '',
            ts: 2,
            turnId: 't1',
            status: 'streaming',
            parts: []
          }
        ]
      }),
      rec({
        op: 'turn-event',
        turnId: 't1',
        updatedAt: 3,
        event: { kind: 'delta', streamId: '0:0', text: 'Voici 100.' }
      }),
      rec({
        op: 'append-messages',
        updatedAt: 4,
        messages: [
          { messageId: 'm3', role: 'user', content: 'quoi eliminer ?', ts: 4, orientation: true }
        ]
      }),
      rec({
        op: 'turn-event',
        turnId: 't1',
        updatedAt: 5,
        event: { kind: 'delta', streamId: '1:0', text: 'brouillon' }
      }),
      rec({
        op: 'turn-event',
        turnId: 't1',
        updatedAt: 5,
        event: { kind: 'stream-reset', streamId: '1:0' }
      }),
      rec({
        op: 'turn-event',
        turnId: 't1',
        updatedAt: 6,
        event: { kind: 'delta', streamId: '2:0', text: 'Les 11 faciles.' }
      }),
      rec({ op: 'turn-event', turnId: 't1', updatedAt: 7, event: { kind: 'done' } })
    ]
    writeFileSync(conversationJournalPath(p), lignes.join('\n') + '\n', 'utf8')
    const conv = loadConversations(p).find((c) => c.id === 'conv-717')!
    const [, assistant, consigne] = conv.messages
    expect(assistant.parts?.map((part) => (part as { text: string }).text)).toEqual([
      'Voici 100.',
      'Les 11 faciles.'
    ])
    expect(consigne).toMatchObject({ orientation: true, coupeLaReponse: 1 })
  })
})
