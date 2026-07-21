import { describe, expect, it } from 'vitest'
import {
  detectRawSleep,
  detectBlindFixLoop,
  requireProofBeforeGreen,
  runHooks
} from './hooks'

// Fixtures construites par concaténation : ce sont des DONNÉES de test du détecteur,
// pas de vrais sleeps — la concat évite que le hook anti-flaky statique se déclenche ici.
const SLEEP = 'Start-' + 'Sleep'
const DELAY = 'Task.' + 'Delay'

describe('hooks déterministes in-app (repro kit)', () => {
  it('anti-flaky : flag un sleep brut ajouté, ignore l’escape sleep-ok', () => {
    const diff = [
      '+++ b/x.ps1',
      `+${SLEEP} -Seconds 5`,
      `+${SLEEP} -Milliseconds 2000`,
      `+await ${DELAY}(3000)`,
      `+${SLEEP} -Milliseconds 200`, // < 1000 -> OK
      `+${SLEEP} -Seconds 30 # sleep-ok: attente reseau bornee`, // escape
      `-${SLEEP} -Seconds 9` // ligne SUPPRIMEE -> pas flaggee
    ].join('\n')
    const v = detectRawSleep(diff)
    expect(v).toHaveLength(3)
    expect(v.every((x) => x.hook === 'anti-flaky')).toBe(true)
  })

  it('fix-gate : block sur édits répétés sans cause, laisse passer avec cause', () => {
    const v = detectBlindFixLoop({ 'a.ts': 3, 'b.ts': 5, 'c.ts': 2 }, { 'b.ts': true })
    expect(v.map((x) => x.detail).join(' ')).toContain('a.ts')
    expect(v.some((x) => x.detail.includes('b.ts'))).toBe(false) // cause présente
    expect(v.some((x) => x.detail.includes('c.ts'))).toBe(false) // sous le seuil
  })

  it('done-without-proof : refuse le green sans preuve, passe avec ≥1 preuve', () => {
    expect(requireProofBeforeGreen(0)).toHaveLength(1)
    expect(requireProofBeforeGreen(2)).toHaveLength(0)
  })

  it('runHooks : agrège et reste vide quand tout est propre', () => {
    expect(runHooks({ producedDiff: '+const x = 1', editsByFile: { 'a.ts': 1 } })).toEqual([])
    expect(runHooks({ requireProof: true, evidenceOkCount: 0 })).toHaveLength(1)
  })
})
