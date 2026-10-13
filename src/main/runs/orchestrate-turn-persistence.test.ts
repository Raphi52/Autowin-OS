import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ConversationStore } from '../store/conversations'
import { createOrchestrateTurnPersistence } from './orchestrate-turn-persistence'

function storeWithConversation(): { store: ConversationStore; id: string } {
  const store = new ConversationStore(() => 1)
  const conversation = store.create({ title: 'Reprise', provider: 'cc' })
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

  /*
   * LA LISTE DOIT APPRENDRE LA FERMETURE (conv-914, 2026-10-13). Un tour lancé par le main (run
   * repris, rattaché, direct) allume le spinner de la liste tant qu'il est `streaming`
   * (`hasStreamingTurn`). Sa fermeture ne rechargeait pas la liste : seul `refresh/conversations` le
   * fait, et seule la fin d'un tour de CHAT l'envoyait — le spinner serait resté allumé.
   */
  it('signale sa fermeture une seule fois, APRÈS l’état terminal, sur succès, échec et annulation', () => {
    type Tour = ReturnType<typeof createOrchestrateTurnPersistence>
    const fermetures: Array<(t: Tour) => void> = [
      (t) => t.succeed({ result: 'ok' }),
      (t) => t.fail('boom', false),
      (t) => t.fail('Run annulé', true)
    ]
    for (const fermer of fermetures) {
      const { store, id } = storeWithConversation()
      const statutsVus: Array<string | undefined> = []
      const turn = createOrchestrateTurnPersistence({
        conversations: store,
        conversationId: id,
        turnId: 'turn-ferme',
        onClosed: () => statutsVus.push(store.get(id)!.messages[1].status)
      })
      turn.begin('tâche')
      expect(statutsVus).toEqual([])
      fermer(turn)
      fermer(turn)
      expect(statutsVus).toHaveLength(1)
      expect(statutsVus[0]).not.toBe('streaming')
    }
  })

  /*
   * SPINNER FANTÔME APRÈS UNE REPRISE SOUS UN NOUVEAU TOUR (juge du correctif spinner, conv-914,
   * 2026-10-13). `hydrate` garde `streaming` le tour d'origine d'un checkpoint qui survit. Quand la
   * reprise ne peut pas le réutiliser (autre identité de modèle, snapshot absent, ancien checkpoint),
   * elle ouvre un NOUVEAU tour — et personne ne fermait l'ancien. `hasStreamingTurn` le voit où qu'il
   * soit dans le fil : le spinner restait allumé jusqu'au redémarrage suivant, run fini.
   */
  it('ferme le tour d’origine quand la reprise ouvre un nouveau tour, et le spinner s’éteint à la fin', () => {
    const { store, id } = storeWithConversation()
    store.beginTurn(id, { content: 'la tâche' }, { turnId: 'tour-origine' })
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'tour-migre',
      resumeExisting: false,
      supersededTurnId: 'tour-origine'
    })

    turn.begin('[Rattachement automatique] la tâche')
    const statut = (turnId: string) =>
      store.get(id)!.messages.find((m) => m.role === 'assistant' && m.turnId === turnId)?.status
    expect(statut('tour-origine')).toBe('interrupted')
    expect(statut('tour-migre')).toBe('streaming')

    turn.succeed({ result: 'ok' })
    expect(store.listSummaries().find((s) => s.id === id)!.hasStreamingTurn).toBe(undefined)
  })

  it('écrit la fermeture du tour d’origine dans le journal de CE tour-là, pas dans le nouveau', () => {
    const { store, id } = storeWithConversation()
    store.beginTurn(id, { content: 'la tâche' }, { turnId: 'tour-origine' })
    const journalOrigine: unknown[] = []
    const journalNouveau: unknown[] = []
    createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'tour-migre',
      supersededTurnId: 'tour-origine',
      journalSuperseded: (event) => journalOrigine.push(event),
      journal: (event) => journalNouveau.push(event)
    }).begin('t')
    expect(journalOrigine).toEqual([{ kind: 'interrupted' }])
    expect(journalNouveau).not.toContainEqual({ kind: 'interrupted' })
  })

  it('ne touche pas un tour d’origine déjà terminé, ni le tour repris lui-même', () => {
    const { store, id } = storeWithConversation()
    store.beginTurn(id, { content: 'la tâche' }, { turnId: 'tour-origine' })
    store.applyTurnEvent(id, 'tour-origine', { kind: 'failed', error: 'avant' })
    createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'tour-migre',
      supersededTurnId: 'tour-origine'
    }).begin('t')
    const origine = store.get(id)!.messages.find((m) => m.turnId === 'tour-origine')!
    expect(origine.status).toBe('failed')

    // Même identifiant = reprise du MÊME tour : il ne se ferme pas lui-même.
    store.beginTurn(id, { content: 'x' }, { turnId: 'tour-meme' })
    store.applyTurnEvent(id, 'tour-meme', { kind: 'resumed' })
    createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'tour-meme',
      resumeExisting: true,
      supersededTurnId: 'tour-meme'
    }).begin('x')
    expect(store.get(id)!.messages.find((m) => m.turnId === 'tour-meme')!.status).toBe('streaming')
  })

  it('ne signale aucune fermeture pour un tour jamais ouvert', () => {
    const { store, id } = storeWithConversation()
    let fermetures = 0
    const turn = createOrchestrateTurnPersistence({
      conversations: store,
      conversationId: id,
      turnId: 'turn-jamais',
      onClosed: () => fermetures++
    })
    turn.succeed({ result: 'ok' })
    turn.fail('boom', false)
    expect(fermetures).toBe(0)
  })

  it('chaque tour ouvert par index.ts recharge la liste à sa fermeture', () => {
    const source = readFileSync(new URL('../index.ts', import.meta.url), 'utf8')
    const appels = source.split('createOrchestrateTurnPersistence({').slice(1)
    // Les trois endroits connus le 2026-10-13 : run direct, publication déjà acquise, rattachement.
    expect(appels.length).toBeGreaterThanOrEqual(3)
    for (const appel of appels) {
      // Les options = jusqu'à l'accolade qui ferme l'objet ouvert par `({` (comptage, pas une
      // recherche du premier `})` : l'option `journal` contient elle-même un `})`).
      let profondeur = 1
      let fin = 0
      while (profondeur > 0 && fin < appel.length) {
        if (appel[fin] === '{') profondeur++
        if (appel[fin] === '}') profondeur--
        fin++
      }
      const options = appel.slice(0, fin)
      expect(options).toMatch(
        /onClosed:\s*\(\)\s*=>\s*broadcast\(\{\s*type:\s*'refresh',\s*scope:\s*'conversations'\s*\}\)/
      )
      // Branchement seulement (le comportement est prouvé plus haut) : le rattachement, qui peut
      // ouvrir un NOUVEAU tour, doit nommer le tour d'origine pour le fermer.
      if (/resumeExisting:\s*liveReattachment\.resumeExisting/.test(options)) {
        expect(options).toMatch(/supersededTurnId:\s*tourDOrigine/)
        expect(options).toMatch(/journalSuperseded:/)
      }
    }
    expect(source).toMatch(
      /resumeExisting:\s*liveReattachment\.resumeExisting,\s*supersededTurnId:\s*tourDOrigine/
    )
    // Le tour d'origine possédé par une reprise d'appel chat est exclu AVANT d'être nommé.
    expect(source).toMatch(
      /const tourDOrigine =\s*resumableRun\.turnId && !appelChatReprisPourTour\(conversationId, resumableRun\.turnId\)/
    )
    // Et la question est posée au JOURNAL du tour, pas à `appelsChatReconnusAuChargement` : hydrate
    // ne remplit jamais cette Map pour un tour qui est aussi un checkpoint de run (court-circuit).
    const predicat = source.slice(source.indexOf('const appelChatReprisPourTour'))
    const corps = predicat.slice(0, predicat.indexOf('const resumableTurnIds'))
    expect(corps.length).toBeGreaterThan(0)
    expect(corps).toMatch(/recoverableChatProviderCallForTurn\(turnJournalRoot, conversationId, turnId\)/)
    expect(corps).not.toMatch(/appelsChatReconnusAuChargement/)
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
