import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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
    const c = a.create({ title: 'Persistée', category: 'codex', provider: 'codex' })
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
    expect(b.create({ title: 'x', category: 'claude', provider: 'claude' }).id).not.toBe(c.id)
  })

  it('remove/rename persistent aussi', () => {
    const p = join(dir, 'c2.json')
    const a = new ConversationStore()
    persistConversations(a, p)
    const c1 = a.create({ title: 'un', category: 'claude', provider: 'claude' })
    const c2 = a.create({ title: 'deux', category: 'claude', provider: 'claude' })
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
    const c = a.create({ title: 'avec runs', category: 'claude', provider: 'claude' })
    a.attachRun(c.id, 'C:\\x\\RUN.md')
    a.attachRun(c.id, 'C:\\x\\RUN.md') // doublon ignoré
    const b = new ConversationStore()
    persistConversations(b, p)
    expect(b.get(c.id)?.runPaths).toEqual(['C:\\x\\RUN.md'])
  })

  it('fichier corrompu ou absent → repart vide sans crasher', () => {
    const p = join(dir, 'corrompu.json')
    writeFileSync(p, '{pas du json', 'utf8')
    expect(loadConversations(p)).toEqual([])
    expect(loadConversations(join(dir, 'nexiste.json'))).toEqual([])
    // save ne jette jamais même sur chemin impossible
    expect(() => saveConversations([], join(dir, 'sub', 'ok.json'))).not.toThrow()
  })
})

describe('conversations-disk structured restart', () => {
  it('groups streaming checkpoints but flushes terminal state immediately', () => {
    vi.useFakeTimers()
    const p = join(dir, 'debounced.json')
    const store = new ConversationStore(() => 1000)
    persistConversations(store, p)
    const c = store.create({ title: 'Debounce', category: 'codex', provider: 'codex' })
    store.beginTurn(c.id, { content: 'Go' }, { turnId: 'turn-debounce' })
    const beforeDelta = readFileSync(p, 'utf8')

    store.applyTurnEvent(c.id, 'turn-debounce', {
      kind: 'delta', streamId: '0:0', text: 'partiel'
    })
    expect(readFileSync(p, 'utf8')).toBe(beforeDelta)

    vi.advanceTimersByTime(150)
    expect(readFileSync(p, 'utf8')).toContain('partiel')
    store.applyTurnEvent(c.id, 'turn-debounce', { kind: 'done' })
    expect(readFileSync(p, 'utf8')).toContain('"status": "completed"')
  })

  it('restores ordered parts, results and status after restart', () => {
    const p = join(dir, 'structured.json')
    const a = new ConversationStore(() => 1000)
    persistConversations(a, p)
    const c = a.create({ title: 'Structurée', category: 'codex', provider: 'codex' })
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
