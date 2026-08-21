import { describe, expect, it } from 'vitest'
import { issuesDepuisVerdict, verdictEstReussi } from './pari-liaison'
import type { PariPhase } from '../../shared/pari-calibration'

const pari = (phase: string): PariPhase => ({
  runId: 'run-1',
  phase,
  confiance: 0.7,
  refutateur: 'le juge trouve un défaut',
  emisA: '2026-08-21T10:00:00.000Z'
})

describe('lecture du verdict du juge', () => {
  it('lit la validation depuis le detail de l’étape', () => {
    expect(verdictEstReussi('validé', '')).toBe(true)
    expect(verdictEstReussi('verdict repris · validé', '')).toBe(true)
  })

  it('lit le défaut', () => {
    expect(verdictEstReussi('défaut', '')).toBe(false)
    expect(verdictEstReussi('verdict repris · défaut', '')).toBe(false)
  })

  it('retombe sur la première ligne du verdict quand le detail est absent', () => {
    expect(verdictEstReussi(undefined, 'VALIDE\nSCORE: 88')).toBe(true)
    expect(verdictEstReussi(undefined, 'DEFAUT: preuve absente\nSCORE: 30')).toBe(false)
  })

  it('rend null sur un verdict illisible plutôt que de deviner une réussite', () => {
    expect(verdictEstReussi(undefined, 'texte sans verdict')).toBeNull()
    expect(verdictEstReussi('en cours', '')).toBeNull()
  })

  it('ne prend pas le mot DEFAUT du corps pour un rejet — seule la première ligne tranche', () => {
    expect(verdictEstReussi(undefined, 'VALIDE\nOBJECTIONS:\n- un DEFAUT mineur signalé')).toBe(
      true
    )
  })
})

describe('issues dérivées du verdict', () => {
  it('donne une issue jugée à chaque pari du run', () => {
    const issues = issuesDepuisVerdict([pari('build'), pari('clean')], 'run-1', true)
    expect(issues).toEqual([
      { runId: 'run-1', phase: 'build', reussie: true, jugee: true },
      { runId: 'run-1', phase: 'clean', reussie: true, jugee: true }
    ])
  })

  it('n’attribue le verdict qu’aux paris DE CE run', () => {
    const autre: PariPhase = { ...pari('build'), runId: 'run-2' }
    expect(issuesDepuisVerdict([pari('build'), autre], 'run-1', false)).toEqual([
      { runId: 'run-1', phase: 'build', reussie: false, jugee: true }
    ])
  })

  it('sur un run sans pari, ne fabrique aucune issue', () => {
    expect(issuesDepuisVerdict([], 'run-1', true)).toEqual([])
  })
})

describe('pièges du verdict — entrées trouvées par l’audit', () => {
  it('« invalide » CONTIENT « valide » : ne doit PAS être lu comme une réussite', () => {
    expect(verdictEstReussi('verdict invalide', '')).not.toBe(true)
    expect(verdictEstReussi('défaut : preuve invalide', '')).toBe(false)
    expect(verdictEstReussi('BLOQUÉ: preuve invalide', '')).not.toBe(true)
  })

  it('« non validé » n’est pas « validé »', () => {
    expect(verdictEstReussi('non validé', '')).not.toBe(true)
  })

  it('le VOTE d’un membre du panel n’est pas le verdict de synthèse', () => {
    expect(verdictEstReussi('vote: VALIDE', '')).toBeNull()
    expect(verdictEstReussi('vote: DEFAUT', '')).toBeNull()
  })
})
