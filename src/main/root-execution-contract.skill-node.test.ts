import { describe, expect, it } from 'vitest'
import { programmeSansEcriture, runEnLectureSeule } from './root-execution-contract'

/**
 * R1 du cadre : un run fait de nœuds SKILL ne doit pas être condamné à la clôture pour absence de
 * preuve d'écriture. Un nœud skill s'exécute en `read-only` — exiger de lui une mutation est une
 * exigence structurellement insatisfaisable, exactement le défaut vécu le 2026-08-18 sur `scout`.
 */
describe('clôture d’un run de nœuds skill', () => {
  it('un programme fait de skills est reconnu SANS écriture', () => {
    expect(programmeSansEcriture(['think', 'learn'])).toBe(true)
    expect(programmeSansEcriture(['frame', 'think'])).toBe(true)
  })

  it('un programme qui contient build ou clean reste ÉCRIVANT', () => {
    expect(programmeSansEcriture(['think', 'build'])).toBe(false)
    expect(programmeSansEcriture(['clean'])).toBe(false)
  })

  it('les huit phases gardent leur classement d’origine : judge n’est pas devenu lecture seule', () => {
    expect(programmeSansEcriture(['judge'])).toBe(false)
    expect(programmeSansEcriture(['kaizen'])).toBe(false)
    expect(programmeSansEcriture(['remake'])).toBe(false)
  })

  it('un run JOUÉ uniquement de skills est en lecture seule', () => {
    expect(runEnLectureSeule([{ phase: 'think' }, { phase: 'scout' }])).toBe(true)
    expect(runEnLectureSeule([{ phase: 'think' }, { phase: 'build' }])).toBe(false)
  })

  it('un programme vide ne blanchit rien', () => {
    expect(programmeSansEcriture([])).toBe(false)
    expect(programmeSansEcriture(undefined)).toBe(false)
  })
})
