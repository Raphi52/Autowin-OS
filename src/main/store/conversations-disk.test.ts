import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { ConversationStore } from './conversations'
import { loadConversations, persistConversations, saveConversations } from './conversations-disk'

const dir = mkdtempSync(join(tmpdir(), 'aos-convs-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))
afterEach(() => vi.useRealTimers())

describe('conversations-disk — persistance à chaque mutation', () => {
  it('roundtrip complet : mutations → disque → rechargement dans un store neuf', () => {
    const p = join(dir, 'conversations.json')
    const a = new ConversationStore(() => 1000)
    persistConversations(a, p)
    const c = a.create({ title: 'Persistée', provider: 'codex' })
    a.append(c.id, { role: 'user', content: 'salut' })
    a.append(c.id, { role: 'assistant', content: 'bonjour' })
    expect(existsSync(p)).toBe(true)

    // un « restart » : store neuf branché sur le même fichier
    const b = new ConversationStore(() => 2000)
    persistConversations(b, p)
    const back = b.get(c.id)
    expect(back?.title).toBe('Persistée')
    expect(back?.messages).toHaveLength(2)
    // nextId repart APRÈS les ids existants (pas de collision conv-1)
    expect(b.create({ title: 'x', provider: 'claude' }).id).not.toBe(c.id)
  })

  it('remove/rename persistent aussi', () => {
    const p = join(dir, 'c2.json')
    const a = new ConversationStore()
    persistConversations(a, p)
    const c1 = a.create({ title: 'un', provider: 'claude' })
    const c2 = a.create({ title: 'deux', provider: 'claude' })
    a.rename(c1.id, 'un-bis')
    a.remove(c2.id)
    const back = loadConversations(p)
    expect(back).toHaveLength(1)
    expect(back[0].title).toBe('un-bis')
  })

  it('attachRun persiste les runPaths (idempotent) et survit au rechargement', () => {
    const p = join(dir, 'c3.json')
    const a = new ConversationStore()
    persistConversations(a, p)
    const c = a.create({ title: 'avec runs', provider: 'claude' })
    a.attachRun(c.id, 'C:\\x\\RUN.md')
    a.attachRun(c.id, 'C:\\x\\RUN.md') // doublon ignoré
    const b = new ConversationStore()
    persistConversations(b, p)
    expect(b.get(c.id)?.runPaths).toEqual(['C:\\x\\RUN.md'])
  })

  it('detachRun retire uniquement la pièce jointe visée et persiste le changement', () => {
    const p = join(dir, 'c4.json')
    const store = new ConversationStore()
    persistConversations(store, p)
    const c = store.create({ title: 'avec deux runs', provider: 'claude' })
    store.attachRun(c.id, 'C:\\x\\RUN.md')
    store.attachRun(c.id, 'C:\\y\\RUN.md')

    store.detachRun(c.id, 'C:\\x\\RUN.md')

    const reloaded = new ConversationStore()
    persistConversations(reloaded, p)
    expect(reloaded.get(c.id)?.runPaths).toEqual(['C:\\y\\RUN.md'])
  })

  it('fichier absent retourne vide mais une corruption est explicite', () => {
    const p = join(dir, 'corrompu.json')
    writeFileSync(p, '{pas du json', 'utf8')
    expect(() => loadConversations(p)).toThrow('Store conversations corrompu')
    expect(loadConversations(join(dir, 'nexiste.json'))).toEqual([])
    // Un sous-dossier valide est créé à la demande.
    expect(() => saveConversations([], join(dir, 'sub', 'ok.json'))).not.toThrow()
  })

  it('charge depuis le disque une conversation legacy puis retire son mode a hydratation', () => {
    const p = join(dir, 'legacy-authority-mode.json')
    writeFileSync(
      p,
      JSON.stringify([
        {
          id: 'conv-legacy',
          title: 'Legacy',
          provider: 'codex',
          authorityMode: 'plan',
          messages: [{ role: 'user', content: 'Question', ts: 10 }],
          createdAt: 9,
          updatedAt: 10
        }
      ]),
      'utf8'
    )

    const loaded = loadConversations(p)
    const store = new ConversationStore(() => 20)
    expect(store.hydrate(loaded)).toBe(true)
    expect(store.get('conv-legacy')).not.toHaveProperty('authorityMode')
  })
})

describe('conversations-disk structured restart', () => {
  it('conserve le delta en attente apres une erreur disque transitoire', () => {
    const p = join(dir, 'retry-after-disk-error.json')
    const store = new ConversationStore(() => 1000)
    const flush = persistConversations(store, p)
    const journal = `${p}.journal.jsonl`
    mkdirSync(journal)

    expect(() => store.create({ title: 'Retenue', provider: 'codex' })).toThrow()
    rmSync(journal, { recursive: true, force: true })
    expect(() => flush()).not.toThrow()

    expect(loadConversations(p).map(({ title }) => title)).toContain('Retenue')
  })

  it('persiste un delta sans reserialiser les conversations non liees', () => {
    vi.useFakeTimers()
    const p = join(dir, 'incremental.json')
    const seed = new ConversationStore(() => 1000)
    const target = seed.create({ title: 'Target', provider: 'codex' })
    for (let index = 0; index < 30; index += 1) {
      const unrelated = seed.create({
        title: `Unrelated ${index}`,
        provider: 'codex'
      })
      seed.append(unrelated.id, { role: 'user', content: 'x'.repeat(50_000) })
    }
    saveConversations(seed.list(), p)

    const store = new ConversationStore(() => 2000)
    persistConversations(store, p)
    store.beginTurn(target.id, { content: 'Go' }, { turnId: 'turn-incremental' })
    const journal = `${p}.journal.jsonl`
    expect(existsSync(journal)).toBe(true)
    const beforeDelta = statSync(journal).size

    store.applyTurnEvent(target.id, 'turn-incremental', {
      kind: 'delta',
      streamId: '0:0',
      text: 'petit fragment'
    })
    vi.advanceTimersByTime(150)

    const writtenForDelta = statSync(journal).size - beforeDelta
    expect(writtenForDelta).toBeLessThan(5_000)
    expect(
      loadConversations(p)
        .find(({ id }) => id === target.id)
        ?.messages.at(-1)?.content
    ).toBe('petit fragment')
  })

  it('journalise les evenements du tour plutot que la conversation geante active', () => {
    vi.useFakeTimers()
    const p = join(dir, 'active-large.json')
    const seed = new ConversationStore(() => 1000)
    const target = seed.create({ title: 'Large', provider: 'codex' })
    seed.append(target.id, { role: 'user', content: 'x'.repeat(5 * 1024 * 1024) })
    saveConversations(seed.list(), p)
    const store = new ConversationStore(() => 2000)
    persistConversations(store, p)
    store.beginTurn(target.id, { content: 'Go' }, { turnId: 'turn-large' })
    const journal = `${p}.journal.jsonl`
    const before = statSync(journal).size

    for (let index = 0; index < 10; index += 1) {
      store.applyTurnEvent(target.id, 'turn-large', {
        kind: 'delta',
        streamId: '0:0',
        text: `fragment-${index}`
      })
      vi.advanceTimersByTime(150)
    }

    expect(statSync(journal).size - before).toBeLessThan(20_000)
    expect(loadConversations(p).find(({ id }) => id === target.id)?.messages.at(-1)?.content).toContain(
      'fragment-9'
    )
  })

  it('groups streaming checkpoints but flushes terminal state immediately', () => {
    vi.useFakeTimers()
    const p = join(dir, 'debounced.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    const c = store.create({ title: 'Debounce', provider: 'codex' })
    store.beginTurn(c.id, { content: 'Go' }, { turnId: 'turn-debounce' })
    const beforeDelta = readFileSync(p, 'utf8')

    store.applyTurnEvent(c.id, 'turn-debounce', {
      kind: 'delta',
      streamId: '0:0',
      text: 'partiel'
    })
    expect(readFileSync(p, 'utf8')).toBe(beforeDelta)

    vi.advanceTimersByTime(150)
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('partiel')
    store.applyTurnEvent(c.id, 'turn-debounce', { kind: 'done' })
    expect(loadConversations(p)[0].messages.at(-1)?.status).toBe('completed')
  })

  it('flush() exposé écrit immédiatement l’état débouncé (chemin before-quit)', () => {
    vi.useFakeTimers()
    const p = join(dir, 'flush-quit.json')
    const store = new ConversationStore(() => 1000)
    const flush = persistConversations(store, p)
    const c = store.create({ title: 'Q', provider: 'codex' })
    store.beginTurn(c.id, { content: 'Go' }, { turnId: 't' })
    const before = readFileSync(p, 'utf8')
    store.applyTurnEvent(c.id, 't', { kind: 'delta', streamId: '0:0', text: 'fragment-final' })
    expect(readFileSync(p, 'utf8')).toBe(before) // débouncé, pas encore écrit
    flush() // simule before-quit
    expect(loadConversations(p)[0].messages.at(-1)?.content).toBe('fragment-final')
  })

  it('compacte au redemarrage le journal rejoue dans un snapshot canonique', () => {
    const p = join(dir, 'startup-compaction.json')
    const first = new ConversationStore(() => 1000)
    persistConversations(first, p)
    const conversation = first.create({ title: 'Compact', provider: 'codex' })
    first.append(conversation.id, { role: 'user', content: 'persisted once' })
    const journal = `${p}.journal.jsonl`
    expect(existsSync(journal)).toBe(true)

    const restarted = new ConversationStore(() => 2000)
    persistConversations(restarted, p)

    expect(existsSync(journal)).toBe(false)
    expect(loadConversations(p)[0].messages[0].content).toBe('persisted once')
  })

  it('restores ordered parts, results and status after restart', () => {
    const p = join(dir, 'structured.json')
    const a = new ConversationStore(() => 1000)
    persistConversations(a, p)
    const c = a.create({ title: 'Structurée', provider: 'codex' })
    a.beginTurn(c.id, { content: 'Go' }, { turnId: 'turn-structured' })
    a.applyTurnEvent(c.id, 'turn-structured', {
      kind: 'delta',
      streamId: '0:0',
      text: 'Avant.'
    })
    a.applyTurnEvent(c.id, 'turn-structured', {
      kind: 'command',
      actionId: 'a1',
      name: 'get_state',
      args: { target: 'chat' }
    })
    a.applyTurnEvent(c.id, 'turn-structured', {
      kind: 'result',
      actionId: 'a1',
      name: 'get_state',
      ok: true,
      data: { source: 'disk' }
    })
    a.applyTurnEvent(c.id, 'turn-structured', { kind: 'done' })

    const b = new ConversationStore(() => 2000)
    persistConversations(b, p)
    expect(b.get(c.id)?.messages[1]).toMatchObject({
      turnId: 'turn-structured',
      status: 'completed',
      parts: [
        { kind: 'text', text: 'Avant.' },
        {
          kind: 'action',
          name: 'get_state',
          args: { target: 'chat' },
          ok: true,
          data: { source: 'disk' }
        }
      ]
    })
  })
})

/**
 * INC-6 — suppression du champ persiste `category`, doublon en ecriture seule de `provider`.
 *
 * Le validateur l'EXIGEAIT (`typeof value.category !== 'string'` → store entier declare corrompu,
 * application vide au demarrage). Relacher le validateur et arreter l'ecriture partent donc
 * ensemble. Ces deux fixtures sont la preuve qu'aucune donnee utilisateur n'est perdue dans un
 * sens comme dans l'autre.
 */
describe('conversations-disk — lecture tolerante apres le retrait de `category`', () => {
  const fixture = (extra: Record<string, unknown>): string =>
    JSON.stringify([
      {
        schemaVersion: 3,
        id: 'conv-1',
        title: 'Ancienne',
        provider: 'codex',
        messages: [{ role: 'user', content: 'salut', ts: 1, messageId: 'message-conv-1-1' }],
        createdAt: 1,
        updatedAt: 2,
        ...extra
      }
    ])

  it.each([
    ['AVEC category (fichier ecrit avant ce remake)', { category: 'codex' }],
    ['SANS category (fichier ecrit apres)', {}]
  ])('charge sans jeter et rend la meme valeur affichee : %s', (_nom, extra) => {
    const p = join(dir, `tolerance-${_nom.length}.json`)
    writeFileSync(p, fixture(extra), 'utf8')

    const store = new ConversationStore(() => 1)
    expect(() => store.hydrate(loadConversations(p))).not.toThrow()

    const conversation = store.get('conv-1')
    // Ce que `lister_conversations` (commands.ts) affiche : la valeur est identique a celle que
    // `category` portait, puisque les deux champs etaient toujours egaux.
    expect(conversation?.provider).toBe('codex')
    // Le champ mort n'est plus recopie : sans le `delete`, le spread le ferait vivre a jamais.
    expect(conversation).not.toHaveProperty('category')
    expect(conversation?.messages).toHaveLength(1)
  })

  it('un fichier SANS category n’est plus rejete par le validateur — le store n’est pas vide', () => {
    const p = join(dir, 'validateur-sans-category.json')
    writeFileSync(p, fixture({}), 'utf8')
    // Un rejet du validateur rend un tableau VIDE (store « corrompu ») : c’est exactement le mode
    // de perte que cet increment devait eviter.
    expect(loadConversations(p)).toHaveLength(1)
  })
})
