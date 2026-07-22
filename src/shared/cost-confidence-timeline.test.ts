import { describe, it, expect } from 'vitest'
import { buildCostConfidenceTimeline } from './cost-confidence-timeline'
import type { OrchestrationStep } from '../main/orchestrator'

const s = (o: Partial<OrchestrationStep>): OrchestrationStep => ({ step: 'exec', ...o })

describe('buildCostConfidenceTimeline', () => {
  it('empile les segments en waterfall (offset = somme des durées précédentes)', () => {
    const t = buildCostConfidenceTimeline([
      s({ step: 'exec', role: 'subagent', detail: 'phase frame', durationMs: 100, costUsd: 0.1, tokens: 500 }),
      s({ step: 'exec', role: 'subagent', detail: 'phase build', durationMs: 200, costUsd: 0.2, tokens: 800 }),
      s({ step: 'judge', role: 'judge', detail: 'validé', durationMs: 50, costUsd: 0.05, tokens: 100 })
    ])
    expect(t.segments.map((seg) => seg.offsetMs)).toEqual([0, 100, 300])
    expect(t.segments.map((seg) => seg.label)).toEqual(['frame', 'build', 'judge'])
    expect(t.totalMs).toBe(350)
    expect(t.totalUsd).toBeCloseTo(0.35)
    expect(t.totalTokens).toBe(1400)
  })

  it('confiance = true si le juge a validé', () => {
    expect(
      buildCostConfidenceTimeline([s({ step: 'judge', detail: 'validé' })]).confidence
    ).toBe(true)
    expect(
      buildCostConfidenceTimeline([s({ step: 'judge', detail: 'défaut: X' })]).confidence
    ).toBe(false)
    expect(buildCostConfidenceTimeline([s({ step: 'exec' })]).confidence).toBe(false)
  })

  it('le gate ne crée pas de segment ; un step failed est marqué ok:false', () => {
    const t = buildCostConfidenceTimeline([
      s({ step: 'exec', status: 'failed', durationMs: 10 }),
      s({ step: 'gate', detail: 'BLOQUÉ' })
    ])
    expect(t.segments).toHaveLength(1)
    expect(t.segments[0].ok).toBe(false)
  })

  it('champs manquants → 0 (pas de NaN)', () => {
    const t = buildCostConfidenceTimeline([s({ step: 'exec' })])
    expect(t.segments[0]).toMatchObject({ durationMs: 0, costUsd: 0, tokens: 0, offsetMs: 0 })
    expect(t.totalMs).toBe(0)
  })
})
