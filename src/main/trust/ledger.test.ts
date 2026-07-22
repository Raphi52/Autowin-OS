import { describe, expect, it } from 'vitest'
import { TrustLedger } from './ledger'

describe('TrustLedger', () => {
  it('compte falseGreen quand verdict=green mais humanTruth=red', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'claude', verdict: 'green', humanTruth: 'red' })

    const c = ledger.calibration('claude')
    expect(c.falseGreen).toBe(1)
    expect(c.falseRed).toBe(0)
  })

  it('compte falseRed quand verdict=red mais humanTruth=green', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'claude', verdict: 'red', humanTruth: 'green' })

    const c = ledger.calibration('claude')
    expect(c.falseRed).toBe(1)
    expect(c.falseGreen).toBe(0)
  })

  it('ignore un verdict sans humanTruth dans le calcul de calibration', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'claude', verdict: 'green' })
    ledger.record({ judgeModel: 'claude', verdict: 'green', humanTruth: 'green' })

    const c = ledger.calibration('claude')
    expect(c.total).toBe(2)
    expect(c.confirmed).toBe(1)
    expect(c.accuracy).toBe(1)
  })

  it('calcule une accuracy correcte sur un melange de verdicts confirmes', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'claude', verdict: 'green', humanTruth: 'green' })
    ledger.record({ judgeModel: 'claude', verdict: 'green', humanTruth: 'red' })
    ledger.record({ judgeModel: 'claude', verdict: 'red', humanTruth: 'red' })
    ledger.record({ judgeModel: 'claude', verdict: 'red', humanTruth: 'green' })

    const c = ledger.calibration('claude')
    expect(c.confirmed).toBe(4)
    expect(c.falseGreen).toBe(1)
    expect(c.falseRed).toBe(1)
    expect(c.accuracy).toBe(0.5)
  })

  it('retourne accuracy null quand 0 verdict confirme', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'claude', verdict: 'green' })

    const c = ledger.calibration('claude')
    expect(c.confirmed).toBe(0)
    expect(c.accuracy).toBeNull()
  })

  it('ranking trie par accuracy desc avec les null en dernier', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'good', verdict: 'green', humanTruth: 'green' })
    ledger.record({ judgeModel: 'bad', verdict: 'green', humanTruth: 'red' })
    ledger.record({ judgeModel: 'bad', verdict: 'red', humanTruth: 'green' })
    ledger.record({ judgeModel: 'unconfirmed', verdict: 'green' })

    const ranking = ledger.ranking()
    expect(ranking.map((r) => r.model)).toEqual(['good', 'bad', 'unconfirmed'])
    expect(ranking[0].accuracy).toBe(1)
    expect(ranking[1].accuracy).toBe(0)
    expect(ranking[2].accuracy).toBeNull()
  })

  it('gere plusieurs modeles independamment', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'claude', verdict: 'green', humanTruth: 'green' })
    ledger.record({ judgeModel: 'codex', verdict: 'red', humanTruth: 'green' })

    const claudeCalib = ledger.calibration('claude')
    const codexCalib = ledger.calibration('codex')

    expect(claudeCalib.accuracy).toBe(1)
    expect(codexCalib.accuracy).toBe(0)
    expect(codexCalib.falseRed).toBe(1)
  })

  it('models() retourne les modeles distincts vus', () => {
    const ledger = new TrustLedger()
    ledger.record({ judgeModel: 'claude', verdict: 'green' })
    ledger.record({ judgeModel: 'claude', verdict: 'red' })
    ledger.record({ judgeModel: 'codex', verdict: 'green' })

    expect(ledger.models().sort()).toEqual(['claude', 'codex'])
  })
})

describe('TrustLedger — persistance (F1)', () => {
  it('recharge les verdicts depuis le fichier au démarrage', async () => {
    const { mkdtempSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const path = join(mkdtempSync(join(tmpdir(), 'trust-')), 'trust.jsonl')
    const first = new TrustLedger(path)
    first.record({ judgeModel: 'sol', verdict: 'green', humanTruth: 'green' })
    first.record({ judgeModel: 'sol', verdict: 'red', humanTruth: 'green' })
    const reloaded = new TrustLedger(path)
    const cal = reloaded.calibration('sol')
    expect(cal.total).toBe(2)
    expect(cal.confirmed).toBe(2)
    expect(cal.falseRed).toBe(1)
  })
})
