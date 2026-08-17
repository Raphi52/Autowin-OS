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

  /**
   * INTENTION CONSERVÉE — ne jamais répéter un texte DÉJÀ LU par l'utilisateur — mais le critère est
   * corrigé le 2026-08-17 : ce test comptait `step.text` comme « déjà porté par les étapes », ce qui
   * est FAUX. La carte `result` d'une étape ne transporte que `detail`, `error`, `costUsd` et
   * `durationMs` ; `step.text` n'est émis NULLE PART. Conséquence mesurée sur `conv-1267` : dès qu'une
   * phase produisait du texte, la clôture était supprimée et le tour se terminait sur quatre étiquettes
   * nues — « [a exécuté orchestrate] [a exécuté exec] [a exécuté judge] [a exécuté gate] », zéro mot,
   * alors que judge ET gate avaient passé. La déduplication ne peut porter que sur ce qui est
   * RÉELLEMENT livré au fil.
   */
  it('ne supprime PAS la conclusion à cause d’un texte d’étape jamais affiché', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-4'
    })
    turn.begin('tâche')
    turn.step({ step: 'judge', text: 'raisonnement du juge, jamais rendu dans le fil' })
    turn.succeed({ result: 'verdict final : livraison validée' })
    const message = store.get(id)!.messages[1]
    expect(message.content).toContain('verdict final : livraison validée')
    // Et le tour ne se réduit pas à des étiquettes d'action.
    expect((message.parts ?? []).some((p) => p.kind === 'text')).toBe(true)
  })

  it('ne répète pas un texte que le fil porte DÉJÀ', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-4-bis'
    })
    turn.begin('tâche')
    // Un texte déjà présent dans le tour : c'est ce que l'utilisateur lit, la clôture ne le redit pas.
    store.applyTurnEvent(id, 'turn-4-bis', {
      kind: 'delta',
      streamId: 'turn-4-bis:phase',
      text: 'texte déjà lu'
    })
    turn.succeed({ result: 'texte déjà lu' })
    const content = store.get(id)!.messages[1].content
    expect(content.match(/texte déjà lu/g) ?? []).toHaveLength(1)
  })

  /**
   * Le critère est l'IDENTITÉ, pas la présence : un texte déjà livré ne doit pas éteindre une clôture
   * qui dit autre chose. Sans cette distinction, il suffit qu'une phase ait parlé pour perdre le
   * verdict — c'est la forme faible du défaut de `conv-1267`.
   */
  it('garde une clôture qui dit AUTRE CHOSE qu’un texte déjà livré', () => {
    const { store, id } = storeWithConversation()
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-4-ter'
    })
    turn.begin('tâche')
    store.applyTurnEvent(id, 'turn-4-ter', {
      kind: 'delta',
      streamId: 'turn-4-ter:phase',
      text: 'préambule lu par l’utilisateur'
    })
    turn.succeed({ result: 'verdict distinct du préambule' })
    const content = store.get(id)!.messages[1].content
    expect(content).toContain('préambule lu par l’utilisateur')
    expect(content).toContain('verdict distinct du préambule')
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
    const afterSucceed = handler.slice(handler.indexOf(succeed![0]))
    expect(afterSucceed).toMatch(
      /broadcast\(\{\s*type:\s*'refresh',\s*scope:\s*'chat',\s*convId:\s*conversationId\s*\}\)[\s\S]*return \{ ok: true, result:/
    )
    expect(handler).toContain(`return { ok: true, result: ${succeed![1]} }`)
    expect(handler).toContain('durableTurn.fail(error, aborted)')
    expect(handler).toContain('persistRunLifecycle(lifecycle')
    expect(handler).toMatch(/persistOrchestrationPhaseStart\(\s*phase,/)
    expect(handler).toContain('runId: currentRunId')
  })
})
