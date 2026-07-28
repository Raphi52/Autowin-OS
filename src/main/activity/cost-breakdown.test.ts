import { describe, expect, it } from 'vitest'
import {
  costSamplesFrom,
  summarizeCostBy,
  summarizeCostSamples,
  type PromptCallRecord
} from './prompt-observability'

/**
 * « Ou est passe l'argent ? » — la mesure qui rend le cout PILOTABLE.
 *
 * Contexte (2026-07-28) : il a fallu parser 114 fichiers .jsonl a la main pour decouvrir que la
 * session coutait 26,65 $/h, qu'un juge payait 1,5 $ pour 89 tokens de verdict, et que le
 * cache_read valait 0 partout (cause racine). Ces cas rejouent ces situations reelles.
 */
const call = (
  actor: string,
  costUsd: number,
  opts: { input?: number; output?: number; cacheRead?: number; model?: string } = {}
): PromptCallRecord =>
  ({
    id: `${actor}-${costUsd}`,
    ts: '2026-07-28T00:00:00.000Z',
    conversationId: 'c1',
    turnId: 't1',
    iteration: 0,
    actor,
    provider: 'claude',
    model: opts.model ?? 'opus-5',
    transport: 'cli',
    boundary: 'b',
    limitation: 'l',
    messages: [],
    options: {},
    response: '',
    usage: {
      inputTokens: opts.input ?? 0,
      outputTokens: opts.output ?? 0,
      ...(opts.cacheRead !== undefined ? { cacheReadTokens: opts.cacheRead } : {}),
      costUsd
    }
  }) as PromptCallRecord

/** Fixture d'appel trace finement (prompt-observability). */
const callFixture = (actor: string, costUsd: number, outputTokens: number): PromptCallRecord =>
  ({
    id: `${actor}-${costUsd}-${outputTokens}`,
    ts: '2026-07-28T13:00:00.000Z',
    conversationId: 'conv-75',
    turnId: 't1',
    iteration: 0,
    actor,
    provider: 'claude',
    model: 'claude-opus-5',
    transport: 'cli',
    boundary: 'b',
    limitation: 'l',
    messages: [],
    options: {},
    response: '',
    usage: { inputTokens: 0, outputTokens, costUsd }
  }) as PromptCallRecord

describe('summarizeCostBy — repartition du cout', () => {
  it('classe les postes par cout DECROISSANT (le 1er poste = le 1er levier)', () => {
    const rows = summarizeCostBy([
      call('router', 0.12),
      call('orchestrator', 0.05),
      call('judge', 1.5)
    ])
    expect(rows.map((r) => r.key)).toEqual(['judge', 'router', 'orchestrator'])
    expect(rows[0].costUsd).toBeCloseTo(1.5)
  })

  it('agrege plusieurs appels du MEME acteur', () => {
    const rows = summarizeCostBy([call('judge', 1.5), call('judge', 0.89), call('judge', 0.52)])
    expect(rows).toHaveLength(1)
    expect(rows[0].calls).toBe(3)
    expect(rows[0].costUsd).toBeCloseTo(2.91)
  })

  it('expose un cacheHitRatio de 0 quand le contexte est REECRIT (le symptome de la cause racine)', () => {
    const rows = summarizeCostBy([call('chat', 0.32, { input: 16000, cacheRead: 0 })])
    expect(rows[0].cacheHitRatio).toBe(0)
  })

  it('expose un cacheHitRatio eleve quand le contexte est RELU (etat sain, post-correctif)', () => {
    const rows = summarizeCostBy([call('chat', 0.05, { input: 1600, cacheRead: 16000 })])
    expect(rows[0].cacheHitRatio).toBeGreaterThan(0.9)
  })

  it('sait repartir par MODELE (et pas seulement par role)', () => {
    const rows = summarizeCostBy(
      [
        call('router', 0.12, { model: 'opus-4-8' }),
        call('chat', 0.05, { model: 'fable-5' }),
        call('chat', 0.05, { model: 'fable-5' })
      ],
      'model'
    )
    expect(rows.map((r) => r.key)).toEqual(['opus-4-8', 'fable-5'])
    expect(rows[1].calls).toBe(2)
  })

  it('ne divise jamais par zero et tolere un usage absent', () => {
    const withoutUsage = { ...call('x', 0), usage: undefined } as PromptCallRecord
    const rows = summarizeCostBy([withoutUsage])
    expect(rows[0].cacheHitRatio).toBe(0)
    expect(rows[0].costUsd).toBe(0)
  })

  it('aucun appel → aucune ligne (pas de ligne fantome)', () => {
    expect(summarizeCostBy([])).toEqual([])
  })
})

/**
 * Contrat IPC : la mesure doit etre ATTEIGNABLE depuis le renderer, sinon elle reste un module
 * jamais appele (facade). On verifie la chaine complete main -> preload -> types.
 */
describe('os:costBreakdown — chaine IPC complete', () => {
  const read = (p: string): string =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('node:fs') as typeof import('node:fs')).readFileSync(
      (require('node:path') as typeof import('node:path')).join(__dirname, '..', '..', p),
      'utf8'
    )

  it('le main enregistre le handler et borne la dimension recue', () => {
    const main = read('main/index.ts')
    expect(main).toMatch(/ipcMain\.handle\(\s*'os:costBreakdown'/)
    expect(main).toContain('summarizeCostSamples')
    // Exigence RENFORCEE : le handler doit reconcilier les DEUX journaux, sinon il sous-estime
    // le cout d'un facteur ~7 (mesure conv-75 : 2,83 $ annonces contre ~20,70 $ reels).
    expect(main).toContain('costSamplesFrom(')
    expect(main).toContain('loadConvActivity(')
    // Une dimension arbitraire venue du renderer ne doit pas etre passee telle quelle.
    expect(main).toContain("allowed.includes(")
  })

  it('le preload l’expose et les types le declarent', () => {
    expect(read('preload/index.ts')).toContain("ipcRenderer.invoke('os:costBreakdown'")
    expect(read('preload/index.d.ts')).toContain('costBreakdown:')
    expect(read('preload/index.d.ts')).toContain('cacheHitRatio')
  })
})

/**
 * RECONCILIATION DES DEUX JOURNAUX — le defaut trouve le 2026-07-28 sur conv-75.
 *
 * Le breakdown base sur les seuls prompt-calls annonçait 2,83 $ pour une conversation qui avait
 * coute ~20,70 $ : les deux appels dominants (10,90 $ et 5,72 $) ne vivaient que dans le journal
 * d'activite. Ces cas figent la correction ET son risque principal (le double comptage).
 */
describe('costSamplesFrom — les deux journaux, sans double comptage', () => {
  const activity = (label: string, costUsd: number, outputTokens = 0, model = 'claude-opus-5') => ({
    kind: 'exec',
    label,
    provider: 'claude',
    model,
    costUsd,
    outputTokens
  })

  it('capte un cout present UNIQUEMENT dans l’activite (le cas des 10,90 $)', () => {
    const rows = summarizeCostSamples(
      costSamplesFrom([], [activity('subagent', 10.9, 5000)]),
      'actor'
    )
    expect(rows[0]).toMatchObject({ key: 'subagent' })
    expect(rows[0].costUsd).toBeCloseTo(10.9)
  })

  it('NE COMPTE PAS DEUX FOIS un appel present dans les deux journaux', () => {
    // Meme modele, meme cout, meme sortie => meme appel, vu par deux journaux.
    const call = { ...callFixture('subagent', 0.3684, 2834) }
    const samples = costSamplesFrom([call], [activity('subagent', 0.3684, 2834)])
    expect(samples).toHaveLength(1)
    expect(summarizeCostSamples(samples)[0].costUsd).toBeCloseTo(0.3684)
  })

  it('reconstitue le total REEL de conv-75 (~20,70 $) au lieu des 2,83 $ partiels', () => {
    // Les 4 sous-agents traces DES DEUX COTES + les 2 gros presents seulement en activite.
    const calls = [
      callFixture('subagent', 0.3684, 2834),
      callFixture('subagent', 0.6686, 4138),
      callFixture('subagent', 0.8766, 7109),
      callFixture('subagent', 0.9276, 7722),
      callFixture('orchestrator', 0.1752, 443),
      callFixture('orchestrator', 0.0345, 557)
    ]
    const acts = [
      activity('subagent', 10.9005, 9001),
      activity('subagent', 5.7217, 9002),
      activity('subagent', 1.1095, 9003),
      activity('subagent', 0.3684, 2834), // doublon des prompt-calls
      activity('subagent', 0.6686, 4138), // doublon
      { kind: 'conversation-route', label: 'Contexte courant conservé', costUsd: 0.099, outputTokens: 31 }
    ]
    const rows = summarizeCostSamples(costSamplesFrom(calls, acts), 'actor')
    const total = rows.reduce((sum, row) => sum + row.costUsd, 0)
    expect(total).toBeGreaterThan(20) // avant la correction : 2,83 $
    expect(total).toBeLessThan(21)
    expect(rows[0].key).toBe('subagent') // le poste dominant est bien identifie
    expect(rows.find((r) => r.key === 'router')?.costUsd).toBeCloseTo(0.099)
  })

  it('ecarte les entrees sans cout NI tokens (bruit du journal)', () => {
    const samples = costSamplesFrom([], [
      { kind: 'exec', label: 'subagent' },
      { kind: 'gate', label: 'gate', costUsd: 0, outputTokens: 0 }
    ])
    expect(samples).toEqual([])
  })

  it('attribue le routage a un acteur « router » distinct', () => {
    const rows = summarizeCostSamples(
      costSamplesFrom([], [{ kind: 'conversation-route', label: 'route', costUsd: 0.099, outputTokens: 31 }])
    )
    expect(rows[0].key).toBe('router')
  })

  it('sans activite fournie, le resultat egale l’ancien comportement', () => {
    const calls = [callFixture('judge', 1.5, 89)]
    expect(summarizeCostSamples(costSamplesFrom(calls))[0].costUsd).toBeCloseTo(1.5)
  })
})

describe('acteur d’une entree d’activite — le kind decide, jamais le label seul', () => {
  it('une entree `chat` ne transforme PAS le texte du message en acteur', () => {
    // Cas reel (conv-75) : le label valait « reprend pardon » et apparaissait comme un acteur.
    const rows = summarizeCostSamples(
      costSamplesFrom([], [
        { kind: 'chat', label: 'reprend pardon', costUsd: 0.34, outputTokens: 120 }
      ])
    )
    expect(rows.map((r) => r.key)).not.toContain('reprend pardon')
    expect(rows[0].key).toBe('orchestrator')
  })

  it('mappe chaque kind vers son role', () => {
    const rows = summarizeCostSamples(
      costSamplesFrom([], [
        { kind: 'exec', label: 'subagent', costUsd: 5, outputTokens: 10 },
        { kind: 'judge', label: 'peu importe', costUsd: 3, outputTokens: 11 },
        { kind: 'conversation-route', label: 'Contexte conservé', costUsd: 1, outputTokens: 12 },
        { kind: 'chat', label: 'un message quelconque', costUsd: 0.5, outputTokens: 13 }
      ])
    )
    expect(rows.map((r) => r.key)).toEqual(['subagent', 'judge', 'router', 'orchestrator'])
  })

  it('une entree `exec` sans label reste un subagent (defaut sur), pas « (inconnu) »', () => {
    const rows = summarizeCostSamples(costSamplesFrom([], [{ kind: 'exec', costUsd: 2, outputTokens: 5 }]))
    expect(rows[0].key).toBe('subagent')
  })
})
