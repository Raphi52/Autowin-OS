import { afterEach, describe, expect, it } from 'vitest'
import { appendFileSync, mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendTurnEvent,
  flushTurnJournal,
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
    // Le journal écrit désormais par LOTS : ce test simule un SECOND écrivain (le crash) qui append
    // derrière nous. Il doit donc partir d'un fichier déjà à jour, sinon il mesure l'entrelacement
    // des deux écrivains et non ce qu'il prétend mesurer (une ligne tronquée est ignorée).
    flushTurnJournal(root, 'conv-1', 'turn-1')
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

describe('pruneFinishedTurnJournals — âge avant lecture', () => {
  it("n'ouvre JAMAIS un journal encore FRAIS (aucun parse avant le test d'âge)", () => {
    const root = mkdtempSync(join(tmpdir(), 'prune-order-'))
    mkdirSync(join(root, 'conv-frais'), { recursive: true })
    // Piège hors-modèle : une ENTRÉE `.jsonl` illisible par readFileSync (c'est un dossier → EISDIR).
    // Toute implémentation qui la PARSE avant de tester son âge lève ; celle qui teste l'âge d'abord
    // la voit fraîche et ne l'ouvre jamais.
    mkdirSync(join(root, 'conv-frais', 'tour-frais.jsonl'))
    expect(() => pruneFinishedTurnJournals(root, 7 * 24 * 3_600_000)).not.toThrow()
    expect(pruneFinishedTurnJournals(root, 7 * 24 * 3_600_000)).toBe(0)
    rmSync(root, { recursive: true, force: true })
  })

  it('supprime toujours un journal TERMINÉ et périmé (garde anti-sur-correction)', () => {
    const root = mkdtempSync(join(tmpdir(), 'prune-order-old-'))
    mkdirSync(join(root, 'conv-vieux'), { recursive: true })
    writeFileSync(join(root, 'conv-vieux', 'tour-vieux.jsonl'), `${JSON.stringify({ kind: 'done' })}\n`)
    const future = Date.now() + 30 * 24 * 3_600_000
    expect(pruneFinishedTurnJournals(root, 7 * 24 * 3_600_000, future)).toBe(1)
    rmSync(root, { recursive: true, force: true })
  })
})

describe('turn-journal — horodatage systématique', () => {
  it('pose `at` quand l’émetteur ne le fournit pas (failed / resumed indatables)', () => {
    const avant = Date.now()
    appendTurnEvent(root, 'conv-at', 'turn-1', { kind: 'resumed' })
    appendTurnEvent(root, 'conv-at', 'turn-1', { kind: 'failed', error: 'boum' })
    const events = readTurnJournal(root, 'conv-at', 'turn-1')
    expect(events).toHaveLength(2)
    for (const event of events) {
      expect(typeof event.at).toBe('number')
      expect(event.at as number).toBeGreaterThanOrEqual(avant)
    }
  })

  it('respecte le `at` déjà posé par l’émetteur', () => {
    appendTurnEvent(root, 'conv-at2', 'turn-1', { kind: 'done', at: 42 })
    expect(readTurnJournal(root, 'conv-at2', 'turn-1')[0].at).toBe(42)
  })
})

/*
 * CONTRAT EN TETE DE turn-journal.ts : « un evenement TERMINAL, un par tour ». Mesure du
 * 2026-09-12 : le refus de reprise annonce DEFINITIF revenait a chaque demarrage et reecrivait le
 * MEME `failed` — 92 occurrences dans un seul journal (conv-226, conv-246), 924 lignes « copie
 * durable absente » au total. Une cloture identique n'apporte rien : elle est refusee, bruyamment
 * en test pour que la source soit corrigee plutot que masquee.
 */
describe('turn-journal — cloture idempotente', () => {
  it('refuse bruyamment une seconde cloture identique et n’ecrit qu’une ligne', () => {
    appendTurnEvent(root, 'conv-9', 'turn-9', { kind: 'failed', error: 'copie durable absente' })
    expect(() =>
      appendTurnEvent(root, 'conv-9', 'turn-9', { kind: 'failed', error: 'copie durable absente' })
    ).toThrow(/déjà écrite/)
    const events = readTurnJournal(root, 'conv-9', 'turn-9')
    expect(events.filter((e) => e.kind === 'failed')).toHaveLength(1)
  })

  it('laisse passer une cloture DIFFERENTE (autre erreur, autre type)', () => {
    appendTurnEvent(root, 'conv-10', 'turn-10', { kind: 'failed', error: 'premiere cause' })
    appendTurnEvent(root, 'conv-10', 'turn-10', { kind: 'failed', error: 'autre cause' })
    appendTurnEvent(root, 'conv-10', 'turn-10', { kind: 'done', result: 'ok' })
    expect(readTurnJournal(root, 'conv-10', 'turn-10').map((e) => e.kind)).toEqual([
      'failed',
      'failed',
      'done'
    ])
  })
})
