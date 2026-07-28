import { describe, expect, it } from 'vitest'
import { summarizeCostBy, type PromptCallRecord } from './prompt-observability'

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
    expect(main).toContain('summarizeCostBy')
    // Une dimension arbitraire venue du renderer ne doit pas etre passee telle quelle.
    expect(main).toContain("allowed.includes(")
  })

  it('le preload l’expose et les types le declarent', () => {
    expect(read('preload/index.ts')).toContain("ipcRenderer.invoke('os:costBreakdown'")
    expect(read('preload/index.d.ts')).toContain('costBreakdown:')
    expect(read('preload/index.d.ts')).toContain('cacheHitRatio')
  })
})
