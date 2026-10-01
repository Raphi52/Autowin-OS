import { describe, expect, it } from 'vitest'
import { decouperEnLots, echecsDuRapport, fusionnerRapportsVitest } from './verify-command'

/**
 * Mesuré le 2026-10-01 (conv-770, tour 532299a4) : la vérification avant publication d'un tour qui
 * touchait `src/main/index.ts` et `src/main/commands.ts` a lancé `vitest related` sur 194 tests qui
 * les citent. Commande : 9 121 caractères. Par `cmd.exe /c`, la limite est 8 191 : « La ligne de
 * commande est trop longue », exit 1, aucun rapport, publication bloquée en « tests-rouges ».
 */
const suite = (
  name: string,
  statuts: Array<'passed' | 'failed'>,
  status: 'passed' | 'failed' = statuts.includes('failed') ? 'failed' : 'passed'
): Record<string, unknown> => ({
  name,
  status,
  assertionResults: statuts.map((s, i) => ({
    status: s,
    title: `t${i}`,
    fullName: `${name} t${i}`,
    failureMessages: s === 'failed' ? ['AssertionError: attendu'] : []
  }))
})
const rapport = (suites: Record<string, unknown>[]): string => {
  const assertions = suites.flatMap((s) => s.assertionResults as Array<{ status: string }>)
  const echecs = assertions.filter((a) => a.status === 'failed').length
  return JSON.stringify({
    success: echecs === 0,
    numTotalTests: assertions.length,
    numFailedTests: echecs,
    numPassedTests: assertions.length - echecs,
    numFailedTestSuites: suites.filter((s) => s.status === 'failed').length,
    numTotalTestSuites: suites.length,
    testResults: suites
  })
}

describe('decouperEnLots', () => {
  it('tient chaque lot sous le budget, sans perdre ni réordonner un chemin', () => {
    const chemins = Array.from(
      { length: 194 },
      (_, i) => `src/main/un-test-assez-long-${i}.test.ts`
    )
    const lots = decouperEnLots(chemins, 1000)
    expect(lots.length).toBeGreaterThan(1)
    expect(lots.flat()).toEqual(chemins)
    for (const lot of lots)
      expect(lot.reduce((n, c) => n + c.length + 3, 0)).toBeLessThanOrEqual(1000)
  })

  it('une liste qui tient part en UN seul lot, inchangée', () => {
    expect(decouperEnLots(['a.ts', 'b.test.ts'], 1000)).toEqual([['a.ts', 'b.test.ts']])
  })

  it('un chemin plus long que le budget part seul, jamais perdu ni coupé', () => {
    const long = 'x'.repeat(50)
    expect(decouperEnLots(['a.ts', long, 'b.ts'], 20)).toEqual([['a.ts'], [long], ['b.ts']])
  })
})

describe('fusionnerRapportsVitest', () => {
  it('additionne les comptes ANNONCÉS et garde toutes les suites : la lecture croisée reste concluante', () => {
    const fusion = fusionnerRapportsVitest([
      rapport([suite('a.test.ts', ['passed', 'passed'])]),
      rapport([suite('b.test.ts', ['passed', 'failed'])])
    ])
    const lu = echecsDuRapport(fusion)
    expect(lu.concluant).toBe(true)
    expect(lu.testsJoues).toBe(4)
    expect([...lu.echecs]).toEqual(['b.test.ts > b.test.ts t1 :: AssertionError: attendu'])
    expect(JSON.parse(fusion!).success).toBe(false)
  })

  it('un lot SANS rapport rend la fusion sans rapport : jamais un vert par défaut', () => {
    expect(
      fusionnerRapportsVitest([rapport([suite('a.test.ts', ['passed'])]), undefined])
    ).toBeUndefined()
    expect(
      fusionnerRapportsVitest([rapport([suite('a.test.ts', ['passed'])]), '{ pas du json'])
    ).toBeUndefined()
  })

  it('une suite jouée par deux lots n’est comptée qu’une fois, dans sa version la PIRE', () => {
    const fusion = fusionnerRapportsVitest([
      rapport([suite('commun.test.ts', ['passed']), suite('a.test.ts', ['passed'])]),
      rapport([suite('commun.test.ts', ['failed'])])
    ])
    const lu = echecsDuRapport(fusion)
    expect(lu.concluant).toBe(true)
    expect(lu.testsJoues).toBe(2)
    expect([...lu.echecs]).toEqual([
      'commun.test.ts > commun.test.ts t0 :: AssertionError: attendu'
    ])
  })

  it('un seul rapport est rendu tel quel', () => {
    const seul = rapport([suite('a.test.ts', ['passed'])])
    expect(fusionnerRapportsVitest([seul])).toBe(seul)
  })
})
