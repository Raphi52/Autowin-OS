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

  it('refuse une clôture nominale quand le gate a bloqué la livraison', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-gate-red'
    })

    turn.begin('tâche refusée par le gate')
    turn.succeed({
      result: 'Le correctif reste non livré.',
      valid: false,
      gateBlocked: true,
      gateReasons: ['preuve runtime absente']
    })

    const assistant = store.get(id)!.messages[1]
    expect(assistant.status).toBe('failed')
    expect(assistant.error).toContain('preuve runtime absente')
    expect(assistant.content).toContain('Le correctif reste non livré.')
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

  it('reprend le tour existant sans le dupliquer et rend son état live puis terminal', () => {
    const { store, id } = storeWithConversation()
    store.beginTurn(id, { content: 'tâche interrompue' }, { turnId: 'turn-resume' })
    store.applyTurnEvent(id, 'turn-resume', {
      kind: 'command',
      actionId: 'original',
      name: 'orchestrate',
      args: { task: 'tâche interrompue' }
    })
    store.applyTurnEvent(id, 'turn-resume', { kind: 'interrupted' })
    const journal: string[] = []
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-resume',
      resumeExisting: true,
      journal: (event) => journal.push(event.kind)
    })

    turn.begin('tâche interrompue')
    expect(store.get(id)!.messages).toHaveLength(2)
    expect(store.get(id)!.messages[1].status).toBe('streaming')
    turn.step({ step: 'exec', role: 'subagent', provider: 'codex' })
    turn.succeed({ result: 'terminé' })

    const assistant = store.get(id)!.messages[1]
    expect(assistant.status).toBe('completed')
    expect(
      assistant.parts?.find((part) => part.kind === 'action' && part.actionId === 'original')
    ).toMatchObject({ ok: true, data: { resumed: true } })
    expect(journal[0]).toBe('resumed')
    expect(journal.at(-1)).toBe('done')
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

  it('persiste les fichiers produits comme artefacts du même tour', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-artifact'
    })
    turn.begin('génère une image')
    turn.artifact({
      id: 'image-1',
      name: 'résultat.png',
      mimeType: 'image/png',
      kind: 'image',
      size: 4,
      createdAt: 1,
      encoding: 'base64',
      content: 'iVBORw==',
      source: { provider: 'codex' }
    })
    turn.succeed()

    expect(store.get(id)!.messages[1].parts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'artifact',
          artifact: expect.objectContaining({ id: 'image-1' })
        })
      ])
    )
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
    const start = source.indexOf("ipcMain.handle('os:orchestrate'")
    expect(start, 'handler os:orchestrate introuvable').toBeGreaterThan(-1)
    // Borne = le PROCHAIN handler, quel qu'il soit. Ancrer sur un voisin NOMME
    // (`os:behaviourComposition`) etait un faux vert en attente : le jour ou ce voisin est renomme ou
    // deplace, `indexOf` rend -1, `slice(start, -1)` avale TOUT LE RESTE du fichier, et les assertions
    // passent en trouvant ces chaines ailleurs — le cablage ne serait plus verifie du tout.
    const next = source.indexOf('ipcMain.handle(', start + 20)
    // Contrôle négatif joué : commenter les 4 appels laissait le test VERT (les chaînes
    // survivaient dans le commentaire). On retire donc les lignes de commentaire avant d'asserter,
    // sinon l'oracle certifie du code mort.
    const handler = source
      .slice(start, next > -1 ? next : undefined)
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n')
    expect(handler).toContain('createOrchestrateTurnPersistence(')
    expect(handler).toContain('durableTurn.begin(')
    expect(handler).toContain('durableTurn.step(step)')
    expect(handler).toContain('...(step.artifacts ?? [])')
    expect(handler).toContain('materializeChatArtifact(')
    expect(handler).toContain('durableTurn.artifact(stored)')
    // Le handler ne persiste plus `result` brut mais `delivered` (= result + apprentissage), et
    // rend LA MEME valeur au renderer. Asserter le nom de variable suivait un renommage sans rien
    // garantir ; on asserte donc la PROPRIETE qui compte : ce qui est persiste est ce qui est livre.
    const succeed = /durableTurn\.succeed\((\w+)\)/.exec(handler)
    expect(succeed, 'durableTurn.succeed introuvable').not.toBeNull()
    expect(handler).toContain(`return { ok: true, result: ${succeed![1]} }`)
    expect(handler).toContain('durableTurn.fail(error, aborted)')
    expect(handler).toContain('persistRunLifecycle(lifecycle')
    expect(handler).toMatch(/persistOrchestrationPhaseStart\(\s*phase,/)
    expect(handler).toContain('runId: currentRunId')
  })
})
