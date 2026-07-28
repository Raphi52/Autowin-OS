import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendTurnEvent,
  isTurnFinished,
  listUnfinishedTurns,
  pruneFinishedTurnJournals,
  readTurnJournal,
  turnJournalPath
} from './turn-journal'

let root = mkdtempSync(join(tmpdir(), 'turnjournal-'))
afterEach(() => {
  rmSync(root, { recursive: true, force: true })
  root = mkdtempSync(join(tmpdir(), 'turnjournal-'))
})

describe('turn-journal — écriture / relecture', () => {
  it('append puis relit les événements dans l’ordre', () => {
    appendTurnEvent(root, 'conv-1', 'turn-1', { kind: 'delta', text: 'bonjour' })
    appendTurnEvent(root, 'conv-1', 'turn-1', { kind: 'command', name: 'orchestrate' })
    const events = readTurnJournal(root, 'conv-1', 'turn-1')
    expect(events.map((e) => e.kind)).toEqual(['delta', 'command'])
    expect(events[0].text).toBe('bonjour')
  })

  it('journal absent → [] (aucune exception)', () => {
    expect(readTurnJournal(root, 'nope', 'nope')).toEqual([])
  })

  it('IGNORE une ligne tronquée (crash en pleine écriture) sans perdre le reste', () => {
    appendTurnEvent(root, 'conv-1', 'turn-1', { kind: 'delta', text: 'ok' })
    appendFileSync(turnJournalPath(root, 'conv-1', 'turn-1'), '{"kind":"delta","text":"tronq', 'utf8')
    const events = readTurnJournal(root, 'conv-1', 'turn-1')
    expect(events).toHaveLength(1)
    expect(events[0].text).toBe('ok')
  })

  it('refuse un identifiant qui tenterait de s’échapper du dossier', () => {
    expect(() => turnJournalPath(root, '..', 'x')).toThrow(/invalide/)
  })
})

describe('turn-journal — tours inachevés (ce qu’on reprend au démarrage)', () => {
  it('un tour SANS événement terminal est inachevé ; avec `done` il ne l’est plus', () => {
    appendTurnEvent(root, 'conv-A', 'turn-open', { kind: 'delta', text: 'en cours' })
    appendTurnEvent(root, 'conv-A', 'turn-closed', { kind: 'delta', text: 'fini' })
    appendTurnEvent(root, 'conv-A', 'turn-closed', { kind: 'done' })

    const unfinished = listUnfinishedTurns(root)
    expect(unfinished.map((t) => t.turnId)).toEqual(['turn-open'])
    expect(unfinished[0]).toMatchObject({ conversationId: 'conv-A', events: 1 })
    expect(isTurnFinished(readTurnJournal(root, 'conv-A', 'turn-closed'))).toBe(true)
  })

  it('`cancelled` et `error` clôturent aussi (rien à reprendre)', () => {
    appendTurnEvent(root, 'c', 't1', { kind: 'cancelled' })
    appendTurnEvent(root, 'c', 't2', { kind: 'error', message: 'boom' })
    expect(listUnfinishedTurns(root)).toEqual([])
  })

  it('racine absente → [] (pas de journal = comportement historique)', () => {
    expect(listUnfinishedTurns(join(root, 'absent'))).toEqual([])
  })

  it('ignore un fichier non-jsonl et un journal vide', () => {
    mkdirSync(join(root, 'conv-B'), { recursive: true })
    writeFileSync(join(root, 'conv-B', 'notes.txt'), 'bruit', 'utf8')
    writeFileSync(join(root, 'conv-B', 'vide.jsonl'), '', 'utf8')
    expect(listUnfinishedTurns(root)).toEqual([])
  })
})

describe('turn-journal — GC', () => {
  it('purge les journaux TERMINÉS anciens, JAMAIS un tour inachevé', () => {
    appendTurnEvent(root, 'c', 'old-done', { kind: 'done' })
    appendTurnEvent(root, 'c', 'old-open', { kind: 'delta', text: 'à reprendre' })
    const future = Date.now() + 30 * 24 * 3_600_000 // 30 j plus tard → tout est « ancien »
    expect(pruneFinishedTurnJournals(root, 7 * 24 * 3_600_000, future)).toBe(1)
    expect(readTurnJournal(root, 'c', 'old-done')).toEqual([])
    expect(readTurnJournal(root, 'c', 'old-open')).toHaveLength(1) // préservé
  })

  it('ne purge pas un journal terminé RÉCENT', () => {
    appendTurnEvent(root, 'c', 'fresh', { kind: 'done' })
    expect(pruneFinishedTurnJournals(root)).toBe(0)
  })
})
