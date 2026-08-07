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

  it('byCategory filtre par catégorie', () => {
    const store = new ConversationStore(makeClock())
    const native = store.create({ title: 'A', category: 'native', provider: 'p' })
    store.create({ title: 'B', category: 'codex', provider: 'p' })

    const result = store.byCategory('native')
    expect(result).toEqual([native])
  })

  it('categories retourne les catégories distinctes', () => {
    const store = new ConversationStore(makeClock())
    store.create({ title: 'A', category: 'native', provider: 'p' })
    store.create({ title: 'B', category: 'codex', provider: 'p' })
    store.create({ title: 'C', category: 'native', provider: 'p' })

    expect(store.categories().sort()).toEqual(['codex', 'native'])
  })

  it('rename change le titre', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'native', provider: 'p' })

    store.rename(conv.id, 'Nouveau titre')

    expect(store.get(conv.id)?.title).toBe('Nouveau titre')
  })

  it('change et persiste le mode d’autorité de la conversation', () => {
    const store = new ConversationStore(makeClock())
    const conv = store.create({ title: 'A', category: 'codex', provider: 'codex' })
    let persisted = 0
    store.onChange = () => {
      persisted += 1
    }

    store.setAuthorityMode(conv.id, 'plan')

    expect(store.get(conv.id)?.authorityMode).toBe('plan')
    expect(persisted).toBe(1)
  })

  it('crée atomiquement une conversation avec une autorité explicite', () => {
    const store = new ConversationStore(makeClock())

    const conv = store.create({
      title: 'Ticket distant',
      category: 'codex',
      provider: 'codex',
      authorityMode: 'ask'
    })

    expect(conv.authorityMode).toBe('ask')
    expect(store.get(conv.id)?.authorityMode).toBe('ask')
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
      content: 'Je vérifie.\n[a exécuté get_state]'
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
