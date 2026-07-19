import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { TraceLedger } from './ledger'

const dir = mkdtempSync(join(tmpdir(), 'aos-ledger-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('TraceLedger — traçage append-only des agents in-app', () => {
  it('append puis relit (du plus récent au plus ancien)', () => {
    const l = new TraceLedger(dir)
    l.append({ source: 'bus', name: 'navigate', detail: '{"tab":"memory"}', ok: true })
    l.append({ source: 'bus', name: 'create_conversation', ok: true })
    l.append({ source: 'orchestrate', name: 'judge', detail: 'judge codex' })
    const r = l.recent(10)
    expect(r).toHaveLength(3)
    expect(r[0].name).toBe('judge') // le plus récent d'abord
    expect(r[2]).toMatchObject({ source: 'bus', name: 'navigate', ok: true })
  })

  it('cap n respecté', () => {
    const l = new TraceLedger(dir)
    expect(l.recent(2)).toHaveLength(2)
  })

  it('dossier vide/absent → liste vide, append ne jette jamais', () => {
    const l = new TraceLedger(join(dir, 'sub-nexiste-pas'))
    expect(l.recent()).toEqual([])
    expect(() => l.append({ source: 'pilot', name: 'x' })).not.toThrow()
    expect(l.recent()).toHaveLength(1) // le dossier a été créé au premier append
  })
})
