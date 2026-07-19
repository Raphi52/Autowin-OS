import { describe, expect, it } from 'vitest'
import { parseJsonl, recurrentPatterns, summary, type GateEvent } from './kaizen'

describe('parseJsonl', () => {
  it('parse des lignes JSON valides', () => {
    const text = '{"gate":"fix-gate","outcome":"block"}\n{"gate":"anti-flaky","outcome":"pass"}'
    const events = parseJsonl(text)
    expect(events).toEqual([
      { gate: 'fix-gate', outcome: 'block', file: undefined, session: undefined },
      { gate: 'anti-flaky', outcome: 'pass', file: undefined, session: undefined }
    ])
  })

  it('ignore les lignes vides et les lignes corrompues (non-JSON)', () => {
    const text = [
      '{"gate":"fix-gate","outcome":"block"}',
      '',
      '   ',
      "ceci n'est pas du JSON {{{",
      '{"gate":"anti-flaky","outcome":"pass"}'
    ].join('\n')

    const events = parseJsonl(text)
    expect(events).toHaveLength(2)
    expect(events.map((e) => e.gate)).toEqual(['fix-gate', 'anti-flaky'])
  })

  it('ignore les objets JSON valides mais sans gate/outcome exploitables', () => {
    const text = '{"foo":"bar"}\n{"gate":"fix-gate","outcome":"unknown-outcome"}'
    expect(parseJsonl(text)).toEqual([])
  })

  it('retourne [] pour un texte vide', () => {
    expect(parseJsonl('')).toEqual([])
  })
})

describe('summary', () => {
  it('compte les events par outcome', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'revert' },
      { gate: 'anti-flaky', outcome: 'pass' }
    ]
    expect(summary(events)).toEqual({ total: 4, blocks: 2, reverts: 1, passes: 1 })
  })

  it('retourne des zéros pour une liste vide', () => {
    expect(summary([])).toEqual({ total: 0, blocks: 0, reverts: 0, passes: 0 })
  })
})

describe('recurrentPatterns', () => {
  it('exclut un groupe sous le seuil (2 blocks < seuil 3)', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' }
    ]
    expect(recurrentPatterns(events, 3)).toEqual([])
  })

  it('inclut un groupe qui atteint le seuil (3 blocks >= seuil 3)', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' },
      { gate: 'fix-gate', outcome: 'block' }
    ]
    const patterns = recurrentPatterns(events, 3)
    expect(patterns).toEqual([{ key: 'fix-gate', count: 3, gate: 'fix-gate', file: undefined }])
  })

  it('ne compte pas les pass, seulement block+revert', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'pass' },
      { gate: 'fix-gate', outcome: 'pass' },
      { gate: 'fix-gate', outcome: 'pass' },
      { gate: 'fix-gate', outcome: 'block' }
    ]
    expect(recurrentPatterns(events, 3)).toEqual([])
  })

  it('distingue le groupement par gate et par gate+file', () => {
    const events: GateEvent[] = [
      { gate: 'fix-gate', outcome: 'block', file: 'a.ts' },
      { gate: 'fix-gate', outcome: 'block', file: 'a.ts' },
      { gate: 'fix-gate', outcome: 'block', file: 'a.ts' },
      { gate: 'fix-gate', outcome: 'revert', file: 'b.ts' }
    ]
    const patterns = recurrentPatterns(events, 3)
    // gate seul: 4 (3 sur a.ts + 1 sur b.ts) ; gate+a.ts: 3 ; gate+b.ts: 1 (sous seuil)
    expect(patterns).toEqual([
      { key: 'fix-gate', count: 4, gate: 'fix-gate', file: undefined },
      { key: 'fix-gate::a.ts', count: 3, gate: 'fix-gate', file: 'a.ts' }
    ])
  })

  it('trie les patterns par count décroissant', () => {
    const events: GateEvent[] = [
      ...Array(3).fill({ gate: 'gate-a', outcome: 'block' }),
      ...Array(5).fill({ gate: 'gate-b', outcome: 'block' })
    ]
    const patterns = recurrentPatterns(events, 3)
    expect(patterns.map((p) => p.gate)).toEqual(['gate-b', 'gate-a'])
    expect(patterns.map((p) => p.count)).toEqual([5, 3])
  })

  it('retourne [] pour une liste vide', () => {
    expect(recurrentPatterns([])).toEqual([])
  })
})
