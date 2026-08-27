import { describe, expect, it } from 'vitest'
import {
  detectTestRunner,
  normalizeProjects,
  parseTestReport,
  summarizeReport
} from './test-projects'

describe('detectTestRunner', () => {
  it('reconnait vitest via devDependencies', () => {
    const d = detectTestRunner({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '^2' } })
    expect(d.runner).toBe('vitest')
    expect(d.args).toContain('--reporter=json')
  })

  it('reconnait jest', () => {
    const d = detectTestRunner({ scripts: { test: 'jest' }, devDependencies: { jest: '^29' } })
    expect(d.runner).toBe('jest')
    expect(d.args).toContain('--json')
  })

  it('rend none quand aucun harnais n est declare', () => {
    // ENTREE QUI DOIT FAIRE ECHOUER une detection trop permissive :
    // un package.json avec un script `test` bidon ne doit PAS passer pour vitest.
    expect(detectTestRunner({ scripts: { test: 'echo no tests' } }).runner).toBe('none')
    expect(detectTestRunner(null).runner).toBe('none')
  })
})

describe('parseTestReport', () => {
  const brut = JSON.stringify({
    numTotalTests: 3,
    testResults: [
      {
        name: '/p/a.test.ts',
        assertionResults: [
          { fullName: 'a > ok', status: 'passed', duration: 4 },
          { fullName: 'a > ko', status: 'failed', duration: 7, failureMessages: ['boom'] }
        ]
      },
      {
        name: '/p/b.test.ts',
        assertionResults: [{ fullName: 'b > skip', status: 'pending', duration: 0 }]
      }
    ]
  })

  it('extrait les cas, leurs fichiers et l erreur', () => {
    const r = parseTestReport(brut)
    expect(r.invalid).toBeUndefined()
    expect(r.cases).toHaveLength(3)
    expect(r.cases[1]).toMatchObject({
      file: '/p/a.test.ts',
      name: 'a > ko',
      status: 'failed',
      error: 'boom'
    })
    expect(r.cases[2].status).toBe('skipped')
  })

  it('tolere du bruit npm avant le JSON', () => {
    expect(parseTestReport(`> projet@1 test\n> vitest run\n${brut}\n`).cases).toHaveLength(3)
  })

  it('avoue une sortie illisible au lieu d inventer un vert', () => {
    const r = parseTestReport('Error: cannot find module vitest')
    expect(r.invalid).toBeTruthy()
    expect(r.cases).toEqual([])
    expect(summarizeReport(r).passed).toBe(0)
  })
})

describe('summarizeReport', () => {
  it('compte par statut, pas le total declare', () => {
    const r = parseTestReport(brut0)
    expect(summarizeReport(r)).toEqual({ passed: 1, failed: 1, skipped: 1, total: 3 })
  })
})

const brut0 = JSON.stringify({
  numTotalTests: 99,
  testResults: [
    {
      name: 'x.test.ts',
      assertionResults: [
        { fullName: 'p', status: 'passed' },
        { fullName: 'f', status: 'failed', failureMessages: ['e'] },
        { fullName: 's', status: 'skipped' }
      ]
    }
  ]
})

describe('normalizeProjects', () => {
  it('deduplique, ignore les entrees invalides et derive un libelle', () => {
    const p = normalizeProjects([
      { root: 'C:/dev/Autowin OS' },
      { root: 'C:/dev/Autowin OS' },
      { root: 'C:/dev/rig', label: 'RIG' },
      { root: '' },
      'nope'
    ])
    expect(p.map((x) => x.label)).toEqual(['Autowin OS', 'RIG'])
    expect(p[0].id).toBeTruthy()
    expect(p[1].root).toBe('C:/dev/rig')
  })
})
