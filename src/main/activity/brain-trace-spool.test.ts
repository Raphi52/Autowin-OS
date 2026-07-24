import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { appendBrainTrace, brainSpoolRoot, readBrainTraces } from './brain-trace-spool'

describe('brain trace spool causal identity', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('persists the explicit turn and retrieval timestamp', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-trace-'))
    roots.push(root)
    appendBrainTrace(
      {
        timestamp: '2026-07-24T10:11:12.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-7',
        query: 'Pourquoi le cache ?',
        injectedChars: 842,
        navigation: {
          query: 'Pourquoi le cache ?',
          minDense: 0.42,
          candidates: [
            { rank: 1, path: 'knowledge/cache.md', type: 'domain', denseCos: 0.81, retained: true }
          ]
        }
      },
      root
    )

    expect(readBrainTraces('conv-1', root)).toMatchObject([
      {
        timestamp: '2026-07-24T10:11:12.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-7',
        injectedChars: 842
      }
    ])
  })

  it('keeps historical traces without a turn id readable but unlinked', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-trace-legacy-'))
    roots.push(root)
    const spool = brainSpoolRoot(root)
    writeFileSync(
      join(spool, 'events.jsonl'),
      `${JSON.stringify({
        timestamp: '2026-07-23T10:00:00.000Z',
        conversationId: 'conv-legacy',
        query: 'legacy',
        injectedChars: 12
      })}\n`,
      'utf8'
    )

    expect(readBrainTraces('conv-legacy', root)[0]).not.toHaveProperty('turnId')
  })
})
