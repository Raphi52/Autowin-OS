import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadConvActivity } from './conv-activity'
import { persistChatUsageSettlement } from './chat-usage-settlement'
import { TraceStore } from './trace-store'
import type { ExecutionUsageSnapshot } from '../execution-supervisor'

function usage(overrides: Partial<ExecutionUsageSnapshot> = {}): ExecutionUsageSnapshot {
  return {
    quoteId: 'quote-chat',
    startedCalls: 1,
    completedCalls: 1,
    failedCalls: 0,
    activeCalls: 0,
    inputTokens: 100,
    outputTokens: 10,
    cacheReadTokens: 0,
    totalTokens: 110,
    freshTokens: 110,
    knownCostUsd: 0.5,
    unpricedCalls: 0,
    unmeteredCalls: 0,
    tokenCoverage: 'complete',
    ...overrides
  }
}

/**
 * Le cout d'un TOUR DE CHAT partait dans le journal de conversation sans son tour, alors que le
 * reglement l'a en main (il l'ecrit deja dans la trace). /rendement devait donc le rattacher a la
 * derniere demande par l'HEURE : faux des qu'un appel se regle apres la demande suivante.
 */
describe('reglement d usage de chat — tour d origine', () => {
  it('ecrit le turnId dans le journal de conversation', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-usage-tour-'))
    const activityRoot = join(root, 'activity')
    const traceStore = new TraceStore(join(root, 'trace'))

    persistChatUsageSettlement({
      conversationId: 'conv-tour',
      turnId: 'turn-42',
      usage: usage(),
      provider: 'claude',
      model: 'opus',
      label: 'chat',
      activityRoot,
      traceStore
    })

    const entries = loadConvActivity('conv-tour', activityRoot)
    expect(entries.length).toBeGreaterThan(0)
    expect(entries.at(-1)?.turnId).toBe('turn-42')
  })

  /**
   * LA FENETRE SERVIE DOIT ETRE MESURABLE, PAS DECLAREE. `inputTokens` du journal est un CUMUL de
   * toutes les iterations du tour (un tour a affiche 10,6 M), donc il ne dit RIEN de l'occupation
   * d'une fenetre. Sans `derniereEntree` persistee, le denominateur de la jauge ne pouvait etre
   * qu'affirme par un humain. Ce test echoue si la ligne cesse de porter la mesure par appel.
   */
  it('ecrit l entree du DERNIER appel, distincte du cumul du tour', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-usage-fenetre-'))
    const activityRoot = join(root, 'activity')
    const traceStore = new TraceStore(join(root, 'trace'))

    persistChatUsageSettlement({
      conversationId: 'conv-fenetre',
      turnId: 'turn-7',
      usage: usage({ inputTokens: 10_608_832, totalTokens: 10_608_900 }),
      provider: 'claude',
      model: 'claude-opus-5',
      label: 'chat',
      derniereEntree: 512_345,
      derniereEntreeCache: 480_000,
      activityRoot,
      traceStore
    })

    const derniere = loadConvActivity('conv-fenetre', activityRoot).at(-1)
    expect(derniere?.derniereEntree).toBe(512_345)
    expect(derniere?.derniereEntreeCache).toBe(480_000)
    // Le cumul reste a part : les confondre est exactement l'erreur que cette ligne evite.
    expect(derniere?.inputTokens).toBe(10_608_832)
  })

  it('n invente aucune mesure quand l appelant n en fournit pas', () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-usage-fenetre-absente-'))
    const activityRoot = join(root, 'activity')
    const traceStore = new TraceStore(join(root, 'trace'))

    persistChatUsageSettlement({
      conversationId: 'conv-sans',
      turnId: 'turn-8',
      usage: usage(),
      provider: 'claude',
      label: 'chat',
      activityRoot,
      traceStore
    })

    expect(loadConvActivity('conv-sans', activityRoot).at(-1)?.derniereEntree).toBeUndefined()
  })
})
