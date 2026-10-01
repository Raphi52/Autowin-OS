import { describe, expect, it } from 'vitest'
import { lectureBruteDuRapport } from './verify-command'

/**
 * Les SUITES en échec d'un rapport vitest, même quand `echecsDuRapport` le déclare non concluant.
 *
 * Mesuré le 2026-10-01 : dans la portée de `src/main/index.ts` (1 555 tests), la suite
 * `moteur-perime-cablage.test.ts` échoue au niveau de la suite, sans assertion nommée — le rapport
 * est alors « non concluant » et ne nomme RIEN, alors qu'elle passe seule. Pour la rejouer isolée, il
 * faut d'abord savoir laquelle a échoué.
 */
const rapport = (contenu: unknown): string => JSON.stringify(contenu)

describe('lectureBruteDuRapport — quelles suites rejouer seules', () => {
  it('nomme les suites en échec et le nombre de tests joués', () => {
    const lu = lectureBruteDuRapport(
      rapport({
        numTotalTests: 1555,
        testResults: [
          { name: 'D:/AutoWinOS/src/main/moteur-perime-cablage.test.ts', status: 'failed' },
          { name: 'D:/AutoWinOS/src/main/a.test.ts', status: 'passed' },
          { name: 'D:/AutoWinOS/src/main/b.test.ts', status: 'failed' }
        ]
      })
    )
    expect(lu).toEqual({
      suitesEnEchec: [
        'D:/AutoWinOS/src/main/moteur-perime-cablage.test.ts',
        'D:/AutoWinOS/src/main/b.test.ts'
      ],
      testsJoues: 1555
    })
  })

  it('ne devine rien sur un rapport absent, illisible ou d’une autre forme', () => {
    expect(lectureBruteDuRapport(undefined)).toBeUndefined()
    expect(lectureBruteDuRapport('')).toBeUndefined()
    expect(lectureBruteDuRapport('{pas du json')).toBeUndefined()
    expect(lectureBruteDuRapport(rapport({ numTotalTests: 3 }))).toBeUndefined()
    expect(
      lectureBruteDuRapport(rapport({ numTotalTests: 3, testResults: [{ status: 'failed' }] }))
    ).toBeUndefined()
  })
})
