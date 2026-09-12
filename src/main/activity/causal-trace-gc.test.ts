import { mkdtempSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MAX_AGE_MS,
  collectCausalTraces,
  inventoryCausalTraces,
  planCausalTraceGc
} from './causal-trace-gc'

const JOUR = 24 * 60 * 60 * 1000

function entree(id: string, ageJours: number, size = 1024) {
  return {
    path: `/racine/${id}.jsonl`,
    conversationId: id,
    size,
    modifiedMs: 1_000_000_000_000 - ageJours * JOUR
  }
}

describe('planCausalTraceGc', () => {
  const nowMs = 1_000_000_000_000

  it('garde une trace plus jeune que la fenêtre', () => {
    expect(planCausalTraceGc([entree('conv-1', 3)], { nowMs }).doomed).toEqual([])
  })

  it('supprime une trace plus vieille que la fenêtre', () => {
    expect(planCausalTraceGc([entree('conv-1', 9)], { nowMs }).doomed).toEqual([
      '/racine/conv-1.jsonl'
    ])
  })

  it('ne touche jamais une conversation protégée, même ancienne', () => {
    const plan = planCausalTraceGc([entree('conv-1', 40), entree('conv-2', 40)], {
      nowMs,
      protectedConversationIds: ['CONV-1']
    })
    expect(plan.doomed).toEqual(['/racine/conv-2.jsonl'])
  })

  it('borne le travail d’une passe et annonce le reste', () => {
    const plan = planCausalTraceGc(
      [entree('conv-1', 40), entree('conv-2', 40), entree('conv-3', 40)],
      { nowMs, maxDeletions: 2 }
    )
    expect(plan.doomed).toHaveLength(2)
    expect(plan.remaining).toBe(1)
  })
})

describe('collectCausalTraces', () => {
  it('supprime les traces anciennes, épargne les récentes et les compteurs de séquence', () => {
    const root = mkdtempSync(join(tmpdir(), 'causal-trace-gc-'))
    const vieille = join(root, 'conv-vieille.jsonl')
    const fraiche = join(root, 'conv-fraiche.jsonl')
    const compteur = join(root, '.conv-vieille.sequence')
    writeFileSync(vieille, 'x'.repeat(2048))
    writeFileSync(fraiche, 'y')
    writeFileSync(compteur, '42')
    const vieux = (Date.now() - 30 * JOUR) / 1000
    utimesSync(vieille, vieux, vieux)
    utimesSync(compteur, vieux, vieux)

    const outcome = collectCausalTraces(root)

    expect(outcome.removed).toBe(1)
    expect(outcome.freedBytes).toBe(2048)
    expect(readdirSync(root).sort()).toEqual(['.conv-vieille.sequence', 'conv-fraiche.jsonl'])
  })

  it('ne casse pas sur une racine absente', () => {
    expect(collectCausalTraces(join(tmpdir(), 'causal-trace-gc-inexistant-xyz')).removed).toBe(0)
    expect(inventoryCausalTraces(join(tmpdir(), 'causal-trace-gc-inexistant-xyz'))).toEqual([])
  })

  it('garde la même fenêtre que les journaux de tour', () => {
    expect(DEFAULT_MAX_AGE_MS).toBe(7 * JOUR)
  })
})
