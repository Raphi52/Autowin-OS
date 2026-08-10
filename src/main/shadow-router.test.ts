import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { recommendShadowRoute, type RouteSample } from './shadow-router'

const samples: RouteSample[] = [
  { phase: 'build', provider: 'openai', model: 'champion', cost: 1, durationMs: 1000, green: true },
  {
    phase: 'build',
    provider: 'openai',
    model: 'champion',
    cost: 1.2,
    durationMs: 1200,
    green: true
  },
  {
    phase: 'build',
    provider: 'openai',
    model: 'champion',
    cost: 0.8,
    durationMs: 800,
    green: false
  },
  {
    phase: 'build',
    provider: 'anthropic',
    model: 'challenger',
    cost: 0.5,
    durationMs: 700,
    green: true
  },
  {
    phase: 'build',
    provider: 'anthropic',
    model: 'challenger',
    cost: 0.6,
    durationMs: 650,
    green: true
  },
  {
    phase: 'build',
    provider: 'anthropic',
    model: 'challenger',
    cost: 0.4,
    durationMs: 750,
    green: true
  },
  {
    phase: 'judge',
    provider: 'anthropic',
    model: 'challenger',
    cost: 9,
    durationMs: 9000,
    green: false
  }
]

describe('shadow route recommendations', () => {
  it('expose l union complete sur les deux contrats preload', () => {
    for (const relative of ['../preload/index.ts', '../preload/index.d.ts']) {
      const source = readFileSync(new URL(relative, import.meta.url), 'utf8')
      expect(source).toMatch(
        /import type \{ ShadowRouteResult \} from ['"]\.\.\/main\/shadow-router['"]/
      )
      expect(source).toMatch(/shadowRouteRecommendation:[\s\S]{0,180}Promise<ShadowRouteResult>/)
    }
  })

  it('deterministically recommends a better challenger for the requested phase', () => {
    const request = {
      phase: 'build',
      champion: { provider: 'openai', model: 'champion' },
      minimumSamples: 3
    }

    const first = recommendShadowRoute(samples, request)
    const second = recommendShadowRoute([...samples].reverse(), request)

    expect(second).toEqual(first)
    expect(first).toMatchObject({
      status: 'recommendation',
      decision: 'trial-challenger',
      confidence: 'medium',
      champion: {
        route: { provider: 'openai', model: 'champion' },
        sampleCount: 3,
        greenRate: 2 / 3,
        averageCost: 1,
        averageDurationMs: 1000
      },
      challenger: {
        route: { provider: 'anthropic', model: 'challenger' },
        sampleCount: 3,
        greenRate: 1,
        averageCost: 0.5,
        averageDurationMs: 700
      }
    })
    expect('explanation' in first && first.explanation).toContain('qualité')
  })

  it('keeps the champion when no challenger improves the evidence', () => {
    const result = recommendShadowRoute(
      [
        ...samples.filter((sample) => sample.model === 'champion'),
        {
          phase: 'build',
          provider: 'other',
          model: 'slower',
          cost: 2,
          durationMs: 2000,
          green: true
        },
        {
          phase: 'build',
          provider: 'other',
          model: 'slower',
          cost: 2,
          durationMs: 2000,
          green: false
        },
        {
          phase: 'build',
          provider: 'other',
          model: 'slower',
          cost: 2,
          durationMs: 2000,
          green: false
        }
      ],
      { phase: 'build', champion: { provider: 'openai', model: 'champion' }, minimumSamples: 3 }
    )

    expect(result).toMatchObject({
      status: 'recommendation',
      decision: 'keep-champion',
      confidence: 'medium'
    })
  })

  it('reports insufficient data instead of manufacturing a recommendation', () => {
    const result = recommendShadowRoute(samples.slice(0, 2), {
      phase: 'build',
      champion: { provider: 'openai', model: 'champion' },
      minimumSamples: 3
    })

    expect(result).toEqual({
      status: 'insufficient-data',
      confidence: 'insufficient',
      phase: 'build',
      reason: 'Le champion requiert au moins 3 échantillons; 2 disponibles.'
    })
  })

  it('rejects invalid measurements instead of silently biasing a recommendation', () => {
    expect(() =>
      recommendShadowRoute(
        [
          {
            phase: 'build',
            provider: 'openai',
            model: 'champion',
            cost: -1,
            durationMs: 10,
            green: true
          }
        ],
        { phase: 'build', champion: { provider: 'openai', model: 'champion' } }
      )
    ).toThrow(/coût/i)
  })
})
