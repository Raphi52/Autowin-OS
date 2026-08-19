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
    expect(latestBrainTraceId('conv-1', 'turn-7', root)).toBe(readBrainTraces('conv-1', root)[0].id)
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

/**
 * LA PERTE D'UNE TRACE BRAIN EST DESORMAIS COMPTEE — le test que la livraison n'a pas eu le temps
 * d'ecrire.
 *
 * L'application a livre elle-meme le correctif de production, en deux commits (`0ff050a0`,
 * `b16d4620`) : compteur, accesseur `brainTraceSpoolHealth()`, puis cablage du `catch`. Son tour a
 * ensuite ete coupe par son budget de duree — 45 min en regime `standard`
 * (`execution-quote.ts`) — parce que chaque `edit_file` paie une suite COMPLETE en verification
 * (~8 min mesurees), soit cinq editions au maximum, reprises comprises. Elle s'est arretee juste
 * avant les tests.
 *
 * Et sa verification etait passee : la suite entiere est verte quand le code neuf n'est teste par
 * personne. Un correctif sans preuve rouge->vert franchit donc sa porte sans etre vu — c'est ce
 * trou-la que ces deux tests ferment.
 */
describe('brainTraceSpoolHealth — une trace perdue laisse une marque', () => {
  // `roots` du premier describe lui est LOCAL : ce bloc tient son propre nettoyage.
  const racines: string[] = []
  afterEach(() => {
    for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
  })

  it('compte la perte et nomme sa cause quand l’ecriture est impossible', () => {
    const avant = brainTraceSpoolHealth()
    // Un FICHIER a la place du dossier du spool : l'ecriture echoue de facon deterministe sur toutes
    // les plateformes, sans manipuler de permissions.
    const racine = mkdtempSync(join(tmpdir(), 'autowin-brain-perte-'))
    racines.push(racine)
    writeFileSync(join(racine, 'brain-trace-spool'), 'pas un dossier', 'utf8')

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T12:00:00.000Z',
        conversationId: 'conv-perte',
        turnId: 'turn-1',
        query: 'trace qui ne pourra pas s’ecrire',
        injectedChars: 10
      },
      racine
    )

    // Le tracage ne casse JAMAIS l'action tracee : il rend `undefined`, il ne jette pas.
    expect(rendu).toBeUndefined()
    const apres = brainTraceSpoolHealth()
    expect(apres.tracesPerdues).toBe(avant.tracesPerdues + 1)
    expect(apres.derniereErreur).toBeTruthy()
    expect(apres.enBonneSante).toBe(false)
  })

  it('CONTRE-EXEMPLE — une ecriture qui REUSSIT ne compte aucune perte', () => {
    const avant = brainTraceSpoolHealth()
    const racine = mkdtempSync(join(tmpdir(), 'autowin-brain-ok-'))
    racines.push(racine)

    const rendu = appendBrainTrace(
      {
        timestamp: '2026-08-19T12:00:01.000Z',
        conversationId: 'conv-ok',
        turnId: 'turn-1',
        query: 'trace nominale',
        injectedChars: 5
      },
      racine
    )

    expect(rendu).toBeTruthy()
    expect(brainTraceSpoolHealth().tracesPerdues).toBe(avant.tracesPerdues)
  })
})
