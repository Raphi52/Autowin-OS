import { describe, expect, it } from 'vitest'
import type { ModelQuotaSnapshot } from '../../../shared/model-quotas'
import {
  summaryForProvider,
  summaryWindowId,
  summaryWindowLabel
} from './ModelQuotaIndicator'

/**
 * Constate sur capture (2026-07-29, modele « GPT-5.4 · ChatGPT » selectionne) : la wheel resumait la
 * fenetre 5 h alors que sur ces offres c'est le quota HEBDOMADAIRE qui contraint reellement l'usage.
 * La wheel etait donc rassurante et sans rapport avec la limite reellement atteinte.
 */
const snapshot = (windows: Array<{ id: string; remainingPercent: number }>, provider: string):
  ModelQuotaSnapshot =>
  ({
    observedAt: '2026-07-29T13:00:00.000Z',
    summary: { remainingPercent: 99, status: 'healthy' },
    models: [
      {
        modelId: `${provider}/x`,
        model: 'x',
        label: 'X',
        provider,
        shared: true,
        status: 'available',
        source: 'test',
        observedAt: '2026-07-29T13:00:00.000Z',
        windows: windows.map((w) => ({ ...w, label: w.id, limitKnown: true }))
      }
    ]
  }) as unknown as ModelQuotaSnapshot

describe('fenetre resumee par la wheel', () => {
  it('ChatGPT (codex) → 7 j, et NON la 5 h', () => {
    expect(summaryWindowId('codex')).toBe('seven-day')
    expect(summaryWindowLabel('codex')).toBe('7 j')
  })

  it('les autres providers gardent la 5 h (capacite immediate)', () => {
    for (const provider of ['claude', 'gemini', 'kimi', undefined]) {
      expect(summaryWindowId(provider)).toBe('five-hour')
      expect(summaryWindowLabel(provider)).toBe('5 h')
    }
  })

  it('sur ChatGPT, resume le 7 j meme quand la 5 h est PLUS BASSE', () => {
    // Le discriminant : avant le fix, le minimum de la 5 h (12 %) gagnait.
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 12 },
        { id: 'seven-day', remainingPercent: 64 }
      ],
      'codex'
    )
    expect(summaryForProvider(snap, 'codex')?.remainingPercent).toBe(64)
  })

  it('sur Claude, resume toujours la 5 h meme quand le 7 j est plus bas', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 80 },
        { id: 'seven-day', remainingPercent: 5 }
      ],
      'claude'
    )
    expect(summaryForProvider(snap, 'claude')?.remainingPercent).toBe(80)
  })

  it('statut derive de la fenetre RETENUE (7 j bas → critique sur ChatGPT)', () => {
    const snap = snapshot(
      [
        { id: 'five-hour', remainingPercent: 100 },
        { id: 'seven-day', remainingPercent: 4 }
      ],
      'codex'
    )
    expect(summaryForProvider(snap, 'codex')?.status).toBe('critical')
  })

  it('ChatGPT sans fenetre 7 j exposee → repli sur ce qui est connu, pas de wheel vide', () => {
    const snap = snapshot([{ id: 'five-hour', remainingPercent: 37 }], 'codex')
    expect(summaryForProvider(snap, 'codex')?.remainingPercent).toBe(37)
  })
})
