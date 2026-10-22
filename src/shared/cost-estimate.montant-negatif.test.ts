import { describe, expect, it } from 'vitest'
import { formatUsd } from './cost-estimate'

// Migré de scripts/arena-panel/p1-cout-negatif.mts (banc /arena, commit 191ab51d), retiré le
// 2026-10-22 (residus, conv-1062) : ce script sans appelant était la SEULE garde de ce correctif.
// Défaut d'origine : formatUsd donnait 3 décimales à TOUT montant négatif (-1.5 -> « -1,500 $ »).
describe('formatUsd — montants négatifs', () => {
  it('un négatif ordinaire garde 2 décimales', () => {
    expect(formatUsd(-1.5)).toBe('-1,50 $')
  })
  it('un négatif sous le centime garde 3 décimales', () => {
    expect(formatUsd(-0.004)).toBe('-0,004 $')
  })
  it('les positifs et le zéro sont inchangés', () => {
    expect(formatUsd(0.004)).toBe('0,004 $')
    expect(formatUsd(1234.5)).toBe('1234,50 $')
    expect(formatUsd(0)).toBe('0 $')
  })
})
