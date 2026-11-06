import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import type { ChatTurnEvent } from '../../shared/chat-turn'
import { ConversationStore } from './conversations'
import { conversationJournalPath, loadConversations } from './conversations-disk'

/**
 * 2026-10-31, saisie ts 1793470923242 : « quand j'ai envoyé mon message ça a suppr la
 * réponse du tour d'avant ». Trois consignes écrites pendant un tour de 3 h ; la première notait
 * une coupure à 51 parts. À 19:06:27, un `stream-reset` du flux `0:0` a retiré 30 parts de texte
 * (dont 20 AVANT la coupure) : la réponse n'avait plus que 50 parts, la coupure 51 ne tombait plus
 * nulle part, et toute la réponse est remontée au-dessus des trois consignes. Les deux suivantes
 * n'avaient, elles, aucune coupure : le message juste au-dessus d'elles était une consigne.
 */
const dir = mkdtempSync(join(tmpdir(), 'aos-coupure-effacement-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

const image = (id: string): ChatTurnEvent => ({
  kind: 'artifact',
  artifact: {
    id,
    name: `${id}.png`,
    mimeType: 'image/png',
    kind: 'image',
    size: 1,
    createdAt: 1,
    source: { provider: 'claude', tool: 'Read' }
  }
})

describe('coupure d’une consigne : elle survit à un effacement et vaut pour chaque consigne', () => {
  it('un texte effacé AVANT la coupure la fait reculer d’autant', () => {
    const store = new ConversationStore(() => 1000)
    const conv = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'fais la vidéo' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Récit 1.' })
    store.applyTurnEvent(conv.id, 't1', image('a'))
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Récit 2.' })
    store.append(conv.id, { role: 'user', content: 'enlève la mascotte', orientation: true })
    store.applyTurnEvent(conv.id, 't1', image('b'))
    store.applyTurnEvent(conv.id, 't1', { kind: 'stream-reset', streamId: '0:0' })
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '1:0', text: 'Conclusion.' })
    const relu = store.get(conv.id)!
    const assistant = relu.messages[1]
    const consigne = relu.messages[2]
    // [image a, image b, Conclusion] : seule l'image a précédait la consigne.
    expect(assistant.parts?.length).toBe(3)
    expect(consigne).toMatchObject({ orientation: true, coupeLaReponse: 1 })
  })

  it('tout ce qui précédait la consigne est effacé : la coupure tombe à 0, pas au-delà', () => {
    const store = new ConversationStore(() => 1000)
    const conv = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'fais la vidéo' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Récit.' })
    store.append(conv.id, { role: 'user', content: 'plus vite', orientation: true })
    store.applyTurnEvent(conv.id, 't1', { kind: 'stream-reset', streamId: '0:0' })
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '1:0', text: 'Conclusion.' })
    expect(store.get(conv.id)!.messages[2]).toMatchObject({ coupeLaReponse: 0 })
  })

  it('effacement de la seule conclusion : le récit reste, la coupure ne bouge que si elle la suivait', () => {
    const store = new ConversationStore(() => 1000)
    const conv = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'fais la vidéo' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Récit.' })
    store.append(conv.id, { role: 'user', content: 'enlève la mascotte', orientation: true })
    store.applyTurnEvent(conv.id, 't1', image('a'))
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Je reviens.' })
    store.applyTurnEvent(conv.id, 't1', {
      kind: 'stream-reset',
      streamId: '0:0',
      conclusionSeule: true
    })
    const [, assistant, consigne] = store.get(conv.id)!.messages
    expect(assistant.parts?.map((part) => (part.kind === 'text' ? part.text : part.kind))).toEqual([
      'Récit.',
      'artifact'
    ])
    expect(consigne).toMatchObject({ coupeLaReponse: 1 })
  })

  it('la 2e consigne du même tour porte aussi sa coupure', () => {
    const store = new ConversationStore(() => 1000)
    const conv = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'fais la vidéo' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Récit.' })
    store.append(conv.id, { role: 'user', content: 'enlève la mascotte', orientation: true })
    store.applyTurnEvent(conv.id, 't1', image('a'))
    store.applyTurnEvent(conv.id, 't1', { kind: 'delta', streamId: '0:0', text: 'Suite.' })
    const apres = store.append(conv.id, {
      role: 'user',
      content: 'le mage doit bouger',
      orientation: true
    })
    expect(apres.messages.at(-2)).toMatchObject({ coupeLaReponse: 1 })
    expect(apres.messages.at(-1)).toMatchObject({ orientation: true, coupeLaReponse: 3 })
  })

  it('le rejeu du journal retrouve la coupure de la 2e consigne et la recale après un effacement', () => {
    const p = join(dir, 'conversations.json')
    writeFileSync(p, '[]', 'utf8')
    const rec = (o: object): string =>
      JSON.stringify({ schema: 'autowin.conversation-change/v1', id: 'conv-1401', ...o })
    const evenement = (updatedAt: number, event: ChatTurnEvent): string =>
      rec({ op: 'turn-event', turnId: 't1', updatedAt, event })
    const consigne = (updatedAt: number, messageId: string, content: string): string =>
      rec({
        op: 'append-messages',
        updatedAt,
        messages: [{ messageId, role: 'user', content, ts: updatedAt, orientation: true }]
      })
    const lignes = [
      JSON.stringify({
        schema: 'autowin.conversation-change/v1',
        op: 'upsert',
        conversation: {
          schemaVersion: 3,
          id: 'conv-1401',
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
          { messageId: 'm1', role: 'user', content: 'fais la vidéo', ts: 2 },
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
      evenement(3, { kind: 'delta', streamId: '0:0', text: 'Récit.' }),
      consigne(4, 'm3', 'enlève la mascotte'),
      evenement(5, image('a')),
      evenement(6, { kind: 'delta', streamId: '0:0', text: 'Suite.' }),
      consigne(7, 'm4', 'le mage doit bouger'),
      evenement(8, { kind: 'stream-reset', streamId: '0:0' }),
      evenement(9, { kind: 'delta', streamId: '1:0', text: 'Conclusion.' }),
      evenement(10, { kind: 'done' })
    ]
    writeFileSync(conversationJournalPath(p), lignes.join('\n') + '\n', 'utf8')
    const conv = loadConversations(p).find((c) => c.id === 'conv-1401')!
    const [, assistant, premiere, seconde] = conv.messages
    expect(assistant.parts?.map((part) => part.kind)).toEqual(['artifact', 'text'])
    // Avant l'effacement : 1 puis 3 ; « Récit. » (avant les deux) et « Suite. » (avant la 2e) partis.
    expect(premiere).toMatchObject({ coupeLaReponse: 0 })
    expect(seconde).toMatchObject({ coupeLaReponse: 1 })
  })
})
