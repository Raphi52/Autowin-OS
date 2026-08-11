import { createHash } from 'node:crypto'
import { appendFileSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OUTCOME_LEARNING_SCHEMA, type OutcomeLearningEventV1 } from '../../shared/run-learning'
import { OutcomeLearningLedger } from './outcome-learning-ledger'

const proposal = (eventId = 'proposal-1'): OutcomeLearningEventV1 => ({
  kind: 'proposal',
  value: {
    schema: OUTCOME_LEARNING_SCHEMA,
    eventId,
    conversationId: 'conv-1',
    turnId: 'turn-1',
    createdAt: '2026-08-11T10:00:00.000Z',
    outcome: 'success',
    title: 'Leçon',
    body: 'Corps autoporté',
    type: 'lesson',
    scope: 'autowin-os',
    source: 'session:turn-1',
    tags: [],
    confidence: 'high',
    candidateId: 'inbox/a.md',
    stored: true,
    truncated: false
  }
})

function path(): string {
  return join(mkdtempSync(join(tmpdir(), 'autowin-learning-ledger-')), 'events.jsonl')
}

describe('OutcomeLearningLedger', () => {
  it('persiste et relit les événements dans leur ordre exact', () => {
    const ledger = new OutcomeLearningLedger(path())
    expect(ledger.append(proposal('a'))).toBe(true)
    expect(ledger.append(proposal('b'))).toBe(true)
    expect(ledger.read()).toEqual({
      events: [proposal('a'), proposal('b')],
      truncatedTail: false
    })
  })

  it('rend un doublon neutre, même depuis une seconde instance', () => {
    const file = path()
    expect(new OutcomeLearningLedger(file).append(proposal('same'))).toBe(true)
    expect(new OutcomeLearningLedger(file).append(proposal('same'))).toBe(false)
    expect(new OutcomeLearningLedger(file).read().events).toHaveLength(1)
  })

  it('réserve atomiquement un tour entre deux instances avant le dépôt Brain', () => {
    const file = path()
    const first = new OutcomeLearningLedger(file)
    const second = new OutcomeLearningLedger(file)
    const release = first.reserveProposalTurn('conv-1', 'turn-1')
    expect(release).toBeTypeOf('function')
    expect(second.reserveProposalTurn('conv-1', 'turn-1')).toBeUndefined()
    first.append(proposal())
    release?.()
    expect(second.reserveProposalTurn('conv-1', 'turn-1')).toBeUndefined()
  })

  it('récupère un verrou orphelin après expiration de sa lease', () => {
    const file = path()
    const key = createHash('sha256').update('conv-1\0turn-1').digest('hex')
    writeFileSync(
      `${file}.${key}.proposal.lock`,
      JSON.stringify({ pid: 999_999, createdAtMs: Date.now() - 120_000 }),
      'utf8'
    )
    const release = new OutcomeLearningLedger(file).reserveProposalTurn('conv-1', 'turn-1')
    expect(release).toBeTypeOf('function')
    release?.()
  })

  it('ignore seulement une queue tronquée après crash', () => {
    const file = path()
    const ledger = new OutcomeLearningLedger(file)
    ledger.append(proposal('safe'))
    appendFileSync(file, '{"kind":"proposal"', 'utf8')
    expect(ledger.read()).toEqual({ events: [proposal('safe')], truncatedTail: true })
  })

  it('échoue fermé sur une ligne corrompue au milieu du journal', () => {
    const file = path()
    appendFileSync(
      file,
      `${JSON.stringify(proposal('a'))}\nnot-json\n${JSON.stringify(proposal('b'))}\n`
    )
    expect(() => new OutcomeLearningLedger(file).read()).toThrow(/ligne 2/i)
  })

  it('refuse une version future inconnue avant toute écriture', () => {
    const ledger = new OutcomeLearningLedger(path())
    const future = proposal() as unknown as { kind: 'proposal'; value: { schema: string } }
    future.value.schema = 'autowin.learning/v99'
    expect(() => ledger.append(future as OutcomeLearningEventV1)).toThrow(/schema/i)
    expect(ledger.read().events).toHaveLength(0)
  })
})
