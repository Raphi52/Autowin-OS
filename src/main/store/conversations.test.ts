import { describe, expect, it } from 'vitest'
import { ConversationStore } from './conversations'

/** Horloge de test : incrémente à chaque appel pour garantir des ts strictement croissants. */
function makeClock(start = 1000): () => number {
  let t = start
  return () => t++
}

describe('ConversationStore', () => {
  it('create crée une conversation vide avec id déterministe', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'Titre', category: 'native', provider: 'anthropic' })

    expect(conv.id).toBe('conv-1')
    expect(conv.title).toBe('Titre')
    expect(conv.category).toBe('native')
    expect(conv.provider).toBe('anthropic')
    expect(conv.messages).toEqual([])
    expect(conv.createdAt).toBe(conv.updatedAt)
  })

  it("create incrémente le compteur d'id à chaque appel", () => {
    const store = new ConversationStore(makeClock())
    const c1 = store.create({ title: 'A', category: 'native', provider: 'p' })
    const c2 = store.create({ title: 'B', category: 'native', provider: 'p' })

    expect(c1.id).toBe('conv-1')
    expect(c2.id).toBe('conv-2')
  })

  it('append ajoute un message et met à jour updatedAt', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'native', provider: 'p' })
    const before = conv.updatedAt

    const updated = store.append(conv.id, { role: 'user', content: 'Salut' })

    expect(updated.messages).toHaveLength(1)
    expect(updated.messages[0]).toMatchObject({ role: 'user', content: 'Salut' })
    expect(updated.updatedAt).toBeGreaterThan(before)
  })

  it('persiste les métadonnées des fichiers joints sans leur contenu', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'claude', provider: 'claude' })
    const updated = store.append(conv.id, {
      role: 'user',
      content: 'Analyse',
      attachments: [{ name: 'notes.md', mimeType: 'text/markdown', size: 7 }]
    })

    expect(updated.messages[0].attachments).toEqual([
      { name: 'notes.md', mimeType: 'text/markdown', size: 7 }
    ])
    expect(JSON.stringify(updated.messages[0])).not.toContain('# Notes')
  })

  it('append sur un id inconnu jette', () => {
    const store = new ConversationStore(makeClock())
    expect(() => store.append('conv-inconnue', { role: 'user', content: 'x' })).toThrow()
  })

  it('get retourne la conversation ou undefined', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'native', provider: 'p' })

    expect(store.get(conv.id)).toBe(conv)
    expect(store.get('conv-inconnue')).toBeUndefined()
  })

  it('list retourne les conversations triées par updatedAt décroissant', () => {
    const store = new ConversationStore(makeClock())
    const c1 = store.create({ title: 'A', category: 'native', provider: 'p' })
    const c2 = store.create({ title: 'B', category: 'native', provider: 'p' })
    // Touche c1 en dernier pour qu'il passe devant c2.
    store.append(c1.id, { role: 'user', content: 'x' })

    const list = store.list()
    expect(list.map((c) => c.id)).toEqual([c1.id, c2.id])
  })

  it('rename change le titre', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'native', provider: 'p' })

    store.rename(conv.id, 'Nouveau titre')

    expect(store.get(conv.id)?.title).toBe('Nouveau titre')
  })

  it("remove supprime la conversation et retourne true/false selon l'existence", () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'native', provider: 'p' })

    expect(store.remove(conv.id)).toBe(true)
    expect(store.get(conv.id)).toBeUndefined()
    expect(store.remove(conv.id)).toBe(false)
  })
})

describe('ConversationStore structured turns', () => {
  it('starts a continuation with an assistant turn only', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'codex', provider: 'codex' })
    store.beginTurn(conv.id, { content: 'Inspecte le depot' }, { turnId: 'turn-1' })
    store.applyTurnEvent(conv.id, 'turn-1', { kind: 'cancelled' })
    store.beginContinuationTurn(conv.id, {
      turnId: 'turn-2',
      runtime: { provider: 'codex', model: 'terra' }
    })
    expect(conv.messages).toHaveLength(3)
    expect(conv.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'assistant'])
    expect(conv.messages[2]).toMatchObject({
      role: 'assistant',
      turnId: 'turn-2',
      status: 'streaming',
      parts: []
    })
    expect(conv.messages.some((message) => message.role === 'user' && message.content === '')).toBe(
      false
    )
  })

  it('creates a durable user + streaming assistant turn before provider execution', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'codex', provider: 'codex' })

    store.beginTurn(
      conv.id,
      {
        content: 'Explique-moi',
        attachments: [{ name: 'a.md', mimeType: 'text/markdown', size: 4 }]
      },
      {
        turnId: 'turn-1',
        runtime: { provider: 'codex', model: 'terra', reasoningEffort: 'ultra' }
      }
    )

    expect(conv.messages).toHaveLength(2)
    expect(conv.messages[0]).toMatchObject({ role: 'user', content: 'Explique-moi' })
    expect(conv.messages[1]).toMatchObject({
      role: 'assistant',
      turnId: 'turn-1',
      status: 'streaming',
      parts: []
    })
  })

  it('applies structured events and keeps content as a compatible projection', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'codex', provider: 'codex' })
    store.beginTurn(conv.id, { content: 'Go' }, { turnId: 'turn-1' })

    store.applyTurnEvent(conv.id, 'turn-1', {
      kind: 'delta',
      streamId: '0:0',
      text: 'Je vérifie.'
    })
    store.applyTurnEvent(conv.id, 'turn-1', {
      kind: 'command',
      actionId: 'a1',
      name: 'get_state',
      args: { target: 'chat' }
    })
    store.applyTurnEvent(conv.id, 'turn-1', {
      kind: 'result',
      actionId: 'a1',
      name: 'get_state',
      ok: true,
      data: { ready: true }
    })
    store.applyTurnEvent(conv.id, 'turn-1', { kind: 'done' })

    expect(conv.messages[1]).toMatchObject({
      status: 'completed',
      // La projection ne porte plus l'étiquette d'une action RÉUSSIE : elle masquait le texte que
      // l'utilisateur lit. Elle reste rendue quand AUCUN texte n'existe — jamais de bulle vide.
      content: 'Je vérifie.'
    })
    expect(conv.messages[1].parts).toHaveLength(2)
  })

  it('migrates legacy messages and marks recovered streaming turns interrupted', () => {
    const store = new ConversationStore(makeClock())
    store.hydrate([
      {
        id: 'conv-4',
        title: 'Legacy',
        category: 'claude',
        provider: 'claude',
        createdAt: 1,
        updatedAt: 2,
        messages: [
          { role: 'assistant', content: 'Ancienne réponse', ts: 2 },
          {
            role: 'assistant',
            content: 'Partiel',
            ts: 3,
            turnId: 'turn-live',
            status: 'streaming',
            parts: [{ kind: 'text', text: 'Partiel', streamId: '0:0' }]
          }
        ]
      }
    ])

    expect(store.get('conv-4')?.messages[0]).toMatchObject({
      status: 'completed',
      parts: [{ kind: 'text', text: 'Ancienne réponse' }]
    })
    expect(store.get('conv-4')?.messages[1].status).toBe('interrupted')
  })
})

/**
 * Ranger une conversation dans un dossier de travail — ce qui la GROUPE dans la liste du Chat.
 * Repris de claude.exe, dont le mécanisme est purement déterministe : le groupe EST le dossier.
 */
describe('ConversationStore — le dossier de travail qui groupe', () => {
  const neuve = (store: ConversationStore): string =>
    store.create({ title: 'T', category: 'claude', provider: 'anthropic' }).id

  it('une conversation naît SANS dossier — on ne devine pas son projet', () => {
    const store = new ConversationStore(makeClock())
    expect(store.get(neuve(store))?.projectPath).toBeUndefined()
  })

  it('poser un dossier le persiste', () => {
    const store = new ConversationStore(makeClock())
    const id = neuve(store)
    store.setProjectPath(id, 'D:/projets/Autowin OS')
    expect(store.get(id)?.projectPath).toBe('D:/projets/Autowin OS')
  })

  it('`null` SORT du dossier et efface le champ, sans laisser de chaîne vide sur disque', () => {
    // Sans ce chemin de retour, un rangement serait définitif : la seule sortie serait de supprimer.
    const store = new ConversationStore(makeClock())
    const id = neuve(store)
    store.setProjectPath(id, 'D:/projets/p')
    store.setProjectPath(id, null)
    expect(store.get(id)?.projectPath).toBeUndefined()
    expect('projectPath' in (store.get(id) as object)).toBe(false)
  })

  it('un chemin fait d’espaces vaut « pas de dossier », pas un groupe fantôme', () => {
    const store = new ConversationStore(makeClock())
    const id = neuve(store)
    store.setProjectPath(id, '   ')
    expect(store.get(id)?.projectPath).toBeUndefined()
  })

  it('ranger ne fait PAS remonter la conversation en tête de liste', () => {
    // La liste est triée par `updatedAt`. Si ranger touchait cette date, un simple classement
    // ferait passer une vieille conversation devant celle sur laquelle on travaille.
    const store = new ConversationStore(makeClock())
    const id = neuve(store)
    const avant = store.get(id)!.updatedAt
    store.setProjectPath(id, 'D:/projets/p')
    expect(store.get(id)?.updatedAt).toBe(avant)
  })

  it('le dossier survit à un rechargement depuis le disque', () => {
    const store = new ConversationStore(makeClock())
    const id = neuve(store)
    store.setProjectPath(id, 'D:/projets/p')
    // `list()` EST ce qui part sur disque (`onChange?.(this.list(), …)`) : recharger depuis lui,
    // plutôt que depuis un objet fabriqué à la main, teste le vrai aller-retour.
    const recharge = new ConversationStore(makeClock())
    recharge.hydrate(store.list())
    expect(recharge.get(id)?.projectPath).toBe('D:/projets/p')
  })

  it('la projection envoyée à la liste porte le dossier — sinon l’UI ne peut pas grouper', () => {
    const store = new ConversationStore(makeClock())
    const id = neuve(store)
    store.setProjectPath(id, 'D:/projets/p')
    expect(store.listSummaries().find((s) => s.id === id)?.projectPath).toBe('D:/projets/p')
  })

  it('un id inconnu ne jette pas et ne crée rien', () => {
    const store = new ConversationStore(makeClock())
    expect(store.setProjectPath('conv-inexistante', 'D:/projets')).toBeUndefined()
  })
})

/**
 * RUN ZOMBIE — LA CONVERSATION NE DOIT JAMAIS RESTER EN ATTENTE D'UNE RÉPONSE QUI NE VIENDRA PAS.
 *
 * Mesuré sur l'état réel (`conv-1056`, 2026-08-07) : un tour assistant persisté `streaming` avec une
 * action `orchestrate` sans résultat, et un checkpoint de run qui ne le référence plus. `hydrate`
 * basculait bien le statut en `interrupted`, mais SANS RIEN DIRE : aucune trace dans le fil, donc
 * l'utilisateur attend une réponse qui n'arrivera jamais, et les actions restent « en cours ».
 *
 * Discriminant : un tour dont le run SURVIT (checkpoint reprenable) ne reçoit PAS l'avis — il va
 * réellement reprendre, l'annoncer interrompu serait un mensonge.
 */
describe('réconciliation au chargement des tours interrompus', () => {
  const zombie = (): Parameters<ConversationStore['hydrate']>[0] => [
    {
      id: 'conv-1056',
      title: 'run interrompu',
      category: 'codex',
      provider: 'codex',
      createdAt: 1,
      updatedAt: 2,
      messages: [
        { role: 'user', content: 'lance le run', ts: 1 },
        {
          role: 'assistant',
          content: '',
          ts: 2,
          turnId: 'turn-zombie',
          status: 'streaming',
          parts: [{ kind: 'action', actionId: '0:orchestrate', name: 'orchestrate' }]
        }
      ]
    }
  ]

  it('un tour `streaming` sans run reprenable est clos ET annoncé dans la conversation', () => {
    const store = new ConversationStore(makeClock())
    store.hydrate(zombie())

    const message = store.get('conv-1056')!.messages.at(-1)!
    expect(message.status).toBe('interrupted')
    expect(message.content).toContain("run `turn-zombie` interrompu — l'application a été fermée")
    // L'action en vol n'est plus « en cours » : son issue ne viendra jamais.
    expect(message.parts?.[0]).toMatchObject({ name: 'orchestrate', interrupted: true })
  })

  it('un tour dont le run est REPRENABLE n’est pas annoncé interrompu', () => {
    const store = new ConversationStore(makeClock())
    store.hydrate(zombie(), { resumableTurnIds: new Set(['turn-zombie']) })

    const message = store.get('conv-1056')!.messages.at(-1)!
    expect(message.status).toBe('streaming')
    expect(message.content).not.toContain('interrompu')
    expect(message.parts?.[0]).not.toHaveProperty('interrupted')
  })

  it('un second chargement ne réempile pas l’avis', () => {
    const store = new ConversationStore(makeClock())
    store.hydrate(zombie())
    const once = store.get('conv-1056')!.messages.at(-1)!.content
    // Le rattachement au démarrage REROUVRE le tour (`resumed` → `streaming`) et le repersiste :
    // constaté sur conv-1056, où quatre redémarrages ont empilé quatre fois le même récapitulatif.
    // Le second chargement retrouve donc bien un tour `streaming` déjà porteur de l'avis.
    const reouvert = store.list().map((conversation) => ({
      ...conversation,
      messages: conversation.messages.map((message) =>
        message.turnId === 'turn-zombie' ? { ...message, status: 'streaming' as const } : message
      )
    }))
    store.hydrate(reouvert)

    expect(store.get('conv-1056')!.messages.at(-1)!.content).toBe(once)
  })

  it("expose l'etat reconcilie au resume que lit la liste des conversations", () => {
    const store = new ConversationStore(makeClock())
    store.hydrate(zombie())

    // `lastAssistantStatus` est exactement ce que `deriveConversationState` consomme cote vue :
    // tant qu'il valait `streaming`, la conversation s'affichait « En cours » pour toujours.
    expect(store.listSummaries()[0]).toMatchObject({
      id: 'conv-1056',
      lastAssistantStatus: 'interrupted'
    })
  })
})
