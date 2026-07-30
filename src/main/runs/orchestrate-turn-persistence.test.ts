import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { createOrchestrateTurnPersistence } from './orchestrate-turn-persistence'

function storeWithConversation(): { store: ConversationStore; id: string } {
  const store = new ConversationStore(() => 1)
  const conversation = store.create({ title: 'Reprise', category: 'claude', provider: 'cc' })
  return { store, id: conversation.id }
}

describe('persistance du tour pour le run direct os:orchestrate', () => {
  it('écrit le tour dans la conversation : tâche, cartes d’étapes, clôture', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-1'
    })

    turn.begin('reprendre la tâche X')
    turn.step({ step: 'exec', role: 'subagent', provider: 'cc', detail: 'scout' })
    turn.step({ step: 'gate', detail: 'clôture', status: 'completed' })
    turn.succeed({ result: 'livraison finale' })

    const messages = store.get(id)!.messages
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[0].content).toBe('reprendre la tâche X')
    const assistant = messages[1]
    expect(assistant.turnId).toBe('turn-1')
    expect(assistant.status).toBe('completed')
    const actions = (assistant.parts ?? []).filter((p) => p.kind === 'action')
    expect(actions).toHaveLength(2)
    expect(assistant.content).toContain('livraison finale')
  })

  it('rend un échec VISIBLE dans le fil au lieu de le jeter', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-2'
    })

    turn.begin('tâche qui casse')
    turn.fail('provider indisponible', false)

    const assistant = store.get(id)!.messages[1]
    expect(assistant.status).toBe('failed')
    expect(assistant.error).toBe('provider indisponible')
  })

  it('marque une annulation comme telle', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-3'
    })
    turn.begin('tâche annulée')
    turn.fail('Run annulé', true)
    expect(store.get(id)!.messages[1].status).toBe('cancelled')
  })

  it('ne duplique pas un texte déjà porté par les étapes', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-4'
    })
    turn.begin('tâche')
    turn.step({ step: 'exec', text: 'texte déjà dit' })
    turn.succeed({ result: 'texte déjà dit' })
    const content = store.get(id)!.messages[1].content
    expect(content.match(/texte déjà dit/g) ?? []).toHaveLength(0)
  })

  it('reste totalement inerte pour un run autonome (aucune conversation ciblée)', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: '__autonomous__',
      turnId: 'turn-5'
    })
    expect(turn.enabled).toBe(false)
    turn.begin('tâche autonome')
    turn.step({ step: 'exec' })
    turn.succeed({ result: 'ok' })
    expect(store.get(id)!.messages).toHaveLength(0)
  })

  it('le handler os:orchestrate câble bien cette persistance (ouverture, étapes, terminal)', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const handler = source.slice(
      source.indexOf("ipcMain.handle('os:orchestrate'"),
      source.indexOf("ipcMain.handle('os:behaviourComposition'")
    )
    expect(handler).toContain('createOrchestrateTurnPersistence(')
    expect(handler).toContain('durableTurn.begin(')
    expect(handler).toContain('durableTurn.step(step)')
    expect(handler).toContain('durableTurn.succeed(result)')
    expect(handler).toContain('durableTurn.fail(error, aborted)')
  })
})
