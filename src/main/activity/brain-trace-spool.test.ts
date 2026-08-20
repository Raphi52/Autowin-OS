import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  appendBrainTrace,
  brainSpoolRoot,
  brainTraceSpoolHealth,
  latestBrainTraceId,
  readBrainTraces
} from './brain-trace-spool'

describe('perte de trace Brain observable', () => {
  const roots: string[] = []

  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  it('compte la trace perdue quand l ecriture echoue, sans jeter', () => {
    // Un fichier en guise de base : la creation du dossier de spool echoue forcement.
    const fauxBase = join(mkdtempSync(join(tmpdir(), 'autowin-brain-perte-')), 'base')
    roots.push(fauxBase)
    writeFileSync(fauxBase, 'pas un dossier', 'utf8')
    const avant = brainTraceSpoolHealth().tracesPerdues

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T09:00:00.000Z',
        conversationId: 'conv-perdue',
        turnId: 'turn-perdu',
        query: 'trace condamnee',
        injectedChars: 7
      },
      fauxBase
    )

    expect(rendu).toBeUndefined()
    const sante = brainTraceSpoolHealth()
    expect(sante.tracesPerdues).toBe(avant + 1)
    expect(sante.enBonneSante).toBe(false)
    expect(sante.derniereErreur).toBeTruthy()
  })

  it('ne signale aucun incident en marche normale', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-nominal-'))
    roots.push(root)
    const avant = brainTraceSpoolHealth().tracesPerdues

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T09:01:00.000Z',
        conversationId: 'conv-saine',
        turnId: 'turn-sain',
        query: 'trace ecrite',
        injectedChars: 42
      },
      root
    )

    expect(rendu?.id).toBeTruthy()
    expect(readBrainTraces('conv-saine', root)).toHaveLength(1)
    expect(brainTraceSpoolHealth().tracesPerdues).toBe(avant)
  })
})

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
        id: expect.any(String),
        timestamp: '2026-07-24T10:11:12.000Z',
        conversationId: 'conv-1',
        turnId: 'turn-7',
        injectedChars: 842
      }
    ])
    expect(latestBrainTraceId('conv-1', 'turn-7', root)).toBe(
      readBrainTraces('conv-1', root)[0].id
    )
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

  it('isole les appels automatiques et explicites par conversation', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-trace-scope-'))
    roots.push(root)
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:00:00.000Z',
        conversationId: 'conv-a',
        turnId: 'turn-1',
        kind: 'automatic',
        query: 'contexte automatique',
        found: true,
        injectedChars: 120
      },
      root
    )
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:01:00.000Z',
        conversationId: 'conv-a',
        kind: 'query',
        query: 'question explicite',
        found: false,
        injectedChars: 0
      },
      root
    )
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:02:00.000Z',
        conversationId: 'conv-b',
        kind: 'query',
        query: 'étranger',
        found: true,
        injectedChars: 42
      },
      root
    )

    expect(readBrainTraces('conv-a', root).map(({ kind, query }) => ({ kind, query }))).toEqual([
      { kind: 'query', query: 'question explicite' },
      { kind: 'automatic', query: 'contexte automatique' }
    ])
  })

  it('conserve un appel Brain après trois rotations', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-rotations-'))
    roots.push(root)
    appendBrainTrace(
      {
        timestamp: '2026-07-30T10:00:00.000Z',
        conversationId: 'conv-durable',
        turnId: 'turn-durable',
        kind: 'automatic',
        query: 'appel durable',
        found: false,
        status: 'empty',
        injectedChars: 0
      },
      root
    )
    const current = join(brainSpoolRoot(root), 'events.jsonl')
    for (let index = 0; index < 3; index += 1) {
      appendFileSync(current, `${'x'.repeat(2 * 1024 * 1024 + 1)}\n`, 'utf8')
      appendBrainTrace(
        {
          timestamp: `2026-07-30T10:0${index + 1}:00.000Z`,
          conversationId: `conv-rotation-${index}`,
          kind: 'query',
          query: `rotation ${index}`,
          found: false,
          status: 'empty',
          injectedChars: 0
        },
        root
      )
    }

    expect(readBrainTraces('conv-durable', root)).toEqual([
      expect.objectContaining({ turnId: 'turn-durable', query: 'appel durable' })
    ])
  })

  it('borne la taille totale du spool apres de nombreuses rotations', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-retention-'))
    roots.push(root)
    const spool = brainSpoolRoot(root)
    const current = join(spool, 'events.jsonl')

    for (let index = 0; index < 12; index += 1) {
      appendFileSync(current, `${'x'.repeat(2 * 1024 * 1024 + 1)}\n`, 'utf8')
      appendBrainTrace(
        {
          timestamp: `2026-07-30T11:${String(index).padStart(2, '0')}:00.000Z`,
          conversationId: `conv-${index}`,
          kind: 'query',
          query: `rotation ${index}`,
          injectedChars: 0
        },
        root
      )
    }

    const totalBytes = readdirSync(spool).reduce(
      (total, name) => total + statSync(join(spool, name)).size,
      0
    )
    expect(totalBytes).toBeLessThanOrEqual(13 * 1024 * 1024)
    expect(readBrainTraces(undefined, root).length).toBeLessThanOrEqual(6)
  })

  it('borne une entree geante et redige aussi navigation.query avant toute persistance', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-brain-entry-bound-'))
    roots.push(root)
    const secret = 'sk-secret-navigation'
    appendBrainTrace(
      {
        timestamp: '2026-08-08T12:00:00.000Z',
        conversationId: 'conv-large',
        query: `token=${secret}${'x'.repeat(20 * 1024 * 1024)}`,
        injectedChars: 0,
        navigation: {
          query: `token=${secret}`,
          minDense: 0.1,
          candidates: []
        }
      },
      root
    )

    const current = join(brainSpoolRoot(root), 'events.jsonl')
    const persisted = readFileSync(current, 'utf8')
    expect(statSync(current).size).toBeLessThanOrEqual(2 * 1024 * 1024)
    expect(persisted).not.toContain(secret)
    expect(readBrainTraces('conv-large', root)).toHaveLength(1)
  })
})
