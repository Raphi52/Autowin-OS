import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from './conversations'
import {
  attendreEcrituresConversations,
  loadConversations,
  persistConversations
} from './conversations-disk'

/**
 * RÉPONSE REMPLACÉE PAR UNE RELANCE, GARDÉE SUR LE MESSAGE : elle reste dans la conversation
 * enregistrée, y compris après un redémarrage, et n'entre jamais dans le contenu du message.
 */
const dir = mkdtempSync(join(tmpdir(), 'aos-reponse-remplacee-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => vi.useRealTimers())

describe('réponse remplacée : gardée sur le message', () => {
  it('le magasin garde la réponse remplacée à part, hors du contenu', () => {
    const store = new ConversationStore(() => 1000)
    const conv = store.create({ title: 't', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'vérifie le chiffre' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', {
      kind: 'delta',
      streamId: '0:0',
      text: 'Le chiffre est 42.'
    })
    store.applyTurnEvent(conv.id, 't1', { kind: 'stream-reset', streamId: '0:0', remplacee: true })
    store.applyTurnEvent(conv.id, 't1', {
      kind: 'delta',
      streamId: '1:0',
      text: 'Le chiffre est 17, vérifié.'
    })
    const reponse = store.get(conv.id)!.messages[1]
    expect(reponse.reponsesRemplacees).toMatchObject([
      { rang: 0, parts: [{ kind: 'text', streamId: '0:0', text: 'Le chiffre est 42.' }] }
    ])
    expect(reponse.parts?.map((part) => (part.kind === 'text' ? part.text : part.kind))).toEqual([
      'Le chiffre est 17, vérifié.'
    ])
    expect(reponse.content).toBe('Le chiffre est 17, vérifié.')
  })

  it('la réponse remplacée survit au rechargement depuis le disque', async () => {
    // Les tours s'écrivent par lot, 120 ms après le dernier delta (minuteur du journal) : sans
    // avancer ce minuteur, le fichier ne porte que le message vide, et le test lirait un faux rouge.
    vi.useFakeTimers()
    const p = join(dir, 'remplacee.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    const conv = store.create({ title: 'Relance', provider: 'claude' })
    store.beginTurn(conv.id, { content: 'vérifie' }, { turnId: 't1' })
    store.applyTurnEvent(conv.id, 't1', {
      kind: 'delta',
      streamId: '0:0',
      text: 'Ancien chiffre 42.'
    })
    store.applyTurnEvent(conv.id, 't1', { kind: 'stream-reset', streamId: '0:0', remplacee: true })
    store.applyTurnEvent(conv.id, 't1', {
      kind: 'delta',
      streamId: '1:0',
      text: 'Chiffre 17, vérifié.'
    })
    vi.advanceTimersByTime(150)
    await attendreEcrituresConversations()

    // Redémarrage : le fichier seul doit redonner la réponse remplacée et la réponse en vigueur.
    const relue = loadConversations(p).find((candidate) => candidate.id === conv.id)!
    const reponse = relue.messages[1]
    expect(reponse.reponsesRemplacees).toMatchObject([
      { rang: 0, parts: [{ kind: 'text', text: 'Ancien chiffre 42.' }] }
    ])
    expect(reponse.content).toBe('Chiffre 17, vérifié.')
  })
})
