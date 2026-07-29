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

/**
 * REGRESSION trouvee par un SCOUT de l'agent Autowin (2026-07-28), verifiee avant correction.
 *
 * `detectRawSleep` filtrait d'abord les lignes ajoutees, PUIS numerotait avec l'index du tableau
 * FILTRE. Des qu'un diff contient du contexte, des suppressions ou un en-tete — c'est-a-dire tout
 * diff unifie reel — le numero rapporte ne designe AUCUNE ligne du diff. Le pointeur de violation
 * envoie donc l'utilisateur au mauvais endroit, ce qui est pire qu'une absence de numero.
 */
describe('detectRawSleep — le numero de ligne doit designer le VRAI diff', () => {
  it('compte les lignes de contexte qui precedent', () => {
    const diff = ['--- a/x.ps1', '+++ b/x.ps1', ' inchangee', '+Start-Sleep 5'].join('\n')
    const [violation] = detectRawSleep(diff)
    expect(violation).toBeDefined()
    // La ligne fautive est la 4e du diff, pas la 1re des lignes ajoutees.
    expect(violation.line).toBe(4)
  })

  it('compte aussi les SUPPRESSIONS', () => {
    const diff = [' contexte', '-ancienne', '+Thread.Sleep(5000)'].join('\n')
    expect(detectRawSleep(diff)[0].line).toBe(3)
  })

  it('reste juste avec plusieurs violations dispersees', () => {
    const diff = [' a', '+Start-Sleep 3', ' b', ' c', '+Task.Delay(9999)'].join('\n')
    expect(detectRawSleep(diff).map((v) => v.line)).toEqual([2, 5])
  })
})
