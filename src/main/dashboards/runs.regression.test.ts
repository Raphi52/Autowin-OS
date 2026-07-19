import { describe, it, expect } from 'vitest'
import { parseRun } from './runs'

// Non-régression : une section à heading ANNOTÉ (« ## Besoin (Phase 1 — …) »)
// doit être trouvée (sinon DoD 0/0 sur les vrais runs — bug vu à l'écran).
describe('parseRun — heading avec suffixe', () => {
  it('compte la DoD sous un ## Besoin annoté', () => {
    const md = [
      'status: open',
      '## Besoin (Phase 1 — boucle)',
      '- [x] a (preuve: x)',
      '- [ ] b (preuve: y)'
    ].join('\n')
    const s = parseRun(md)
    expect(s.dodTotal).toBe(2)
    expect(s.dodChecked).toBe(1)
  })
})

// Non-régression (judge corrector cycle 1) : le status doit venir du HEADER,
// jamais d'un `status:` en texte libre dans le corps (Journal).
describe('parseRun — status borné au header (régression judge)', () => {
  it('ignore un `status:` présent dans le Journal, garde celui du header', () => {
    const md = [
      'status: green',
      'regime: standard',
      '',
      '## Besoin',
      '- [x] a (preuve: x)',
      '',
      '## Journal',
      '[12:03] status: red avant rollback (texte libre)',
      '[12:04] event'
    ].join('\n')
    const s = parseRun(md)
    // AVANT le fix : le 1er `status:` rencontré pouvait être celui du corps → 'red'.
    expect(s.status).toBe('green')
    expect(s.journalEvents).toBe(2)
  })

  it('header sans status → unknown même si le corps contient status:', () => {
    const md = ['regime: critical', '## Journal', '[1] status: green (libre)'].join('\n')
    expect(parseRun(md).status).toBe('unknown')
  })
})
