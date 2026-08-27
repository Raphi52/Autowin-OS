/**
 * DURABILITÉ SANS UN SYSCALL PAR TOKEN.
 *
 * Le journal de tour écrivait `mkdirSync` + `appendFileSync` à CHAQUE événement : 300 deltas =
 * 600 appels disque synchrones dans le process MAIN, pendant que l'utilisateur tape.
 *
 * Ce que ces tests exigent, et l'entrée qui les ferait échouer si la correction était fausse :
 *  (a) 300 deltas + `done` → `readTurnJournal` rend les 301 événements DANS L'ORDRE. Une correction
 *      qui bufferise sans vider sur le chemin terminal perdrait la fin du tour ici.
 *  (b) `mkdirSync` UNE seule fois, `appendFileSync` ≤ 10 fois pour ces 301 événements. Une
 *      correction qui garderait l'écriture par événement échoue sur ce compte.
 *  (c) tour NON terminé, relu immédiatement → les deltas déjà émis sont visibles (la reprise ne doit
 *      jamais dépendre d'un flush qui n'a pas eu lieu).
 *  (d) `error` et `cancelled` vident aussi le tampon — pas seulement `done`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    mkdirSync: vi.fn(real.mkdirSync),
    appendFileSync: vi.fn(real.appendFileSync)
  }
})

const fs = await import('node:fs')
const { appendTurnEvent, readTurnJournal, isTurnFinished } = await import('./turn-journal')

let root = ''
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'turnjournal-batch-'))
  vi.mocked(fs.mkdirSync).mockClear()
  vi.mocked(fs.appendFileSync).mockClear()
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('turn-journal — écriture par LOTS', () => {
  it('300 deltas + done : tout est relu, mkdirSync == 1, appendFileSync <= 10', () => {
    for (let i = 0; i < 300; i += 1)
      appendTurnEvent(root, 'conv-1', 'turn-1', { kind: 'delta', text: `d${i}` })
    appendTurnEvent(root, 'conv-1', 'turn-1', { kind: 'done' })

    const events = readTurnJournal(root, 'conv-1', 'turn-1')
    expect(events).toHaveLength(301)
    expect(events[0].text).toBe('d0')
    expect(events[299].text).toBe('d299')
    expect(events[300].kind).toBe('done')
    expect(isTurnFinished(events)).toBe(true)

    expect(vi.mocked(fs.mkdirSync).mock.calls.length).toBe(1)
    expect(vi.mocked(fs.appendFileSync).mock.calls.length).toBeLessThanOrEqual(10)
  })

  it('tour NON terminé : les deltas déjà émis sont relisibles (reprise préservée)', () => {
    appendTurnEvent(root, 'conv-2', 'turn-2', { kind: 'delta', text: 'a' })
    appendTurnEvent(root, 'conv-2', 'turn-2', { kind: 'delta', text: 'b' })
    const events = readTurnJournal(root, 'conv-2', 'turn-2')
    expect(events.map((e) => e.text)).toEqual(['a', 'b'])
    expect(isTurnFinished(events)).toBe(false)
  })

  it('`error` et `cancelled` vident aussi le tampon', () => {
    appendTurnEvent(root, 'c', 't-err', { kind: 'delta', text: 'x' })
    appendTurnEvent(root, 'c', 't-err', { kind: 'error', message: 'boom' })
    appendTurnEvent(root, 'c', 't-cancel', { kind: 'delta', text: 'y' })
    appendTurnEvent(root, 'c', 't-cancel', { kind: 'cancelled' })
    expect(readTurnJournal(root, 'c', 't-err').map((e) => e.kind)).toEqual(['delta', 'error'])
    expect(readTurnJournal(root, 'c', 't-cancel').map((e) => e.kind)).toEqual(['delta', 'cancelled'])
  })
})
