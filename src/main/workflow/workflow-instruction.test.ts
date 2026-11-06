import { describe, expect, it } from 'vitest'
import { combinePhaseInstruction } from './workflow-instruction'

const skill = 'Méthode du kit : mesurer avant d’affirmer.'

describe('combiner la consigne du workflow et celle de la phase', () => {
  it('sans consigne de workflow, le skill passe intact', () => {
    expect(combinePhaseInstruction(skill)).toBe(skill)
    expect(combinePhaseInstruction(skill, { mode: 'append', text: '   ' })).toBe(skill)
  })

  it('append AJOUTE sans perdre le skill', () => {
    const combine = combinePhaseInstruction(skill, { mode: 'append', text: 'Sois bref.' })
    expect(combine).toContain(skill) // sinon « ajouter » supprimerait les garde-fous du kit
    expect(combine).toContain('Sois bref.')
  })

  it('append SÉPARE les deux sources — sinon le modèle ne sait plus d’où vient quoi', () => {
    const combine = combinePhaseInstruction(skill, { mode: 'append', text: 'Sois bref.' })
    expect(combine).toContain('--- Consigne du workflow ---')
    expect(combine.indexOf(skill)).toBeLessThan(combine.indexOf('Sois bref.'))
  })

  it('replace SUBSTITUE — c’est ce qui permet de comparer une méthode maison au kit', () => {
    expect(combinePhaseInstruction(skill, { mode: 'replace', text: 'Ma méthode.' })).toBe(
      'Ma méthode.'
    )
  })

  it('un replace VIDE ne lance pas la phase sans instruction', () => {
    // Substituer par du vide reviendrait à exécuter à l'aveugle : on garde la base.
    expect(combinePhaseInstruction(skill, { mode: 'replace', text: '' })).toBe(skill)
  })

  it('sans skill installé, la consigne du workflow tient lieu de consigne', () => {
    expect(combinePhaseInstruction('', { mode: 'append', text: 'Sois bref.' })).toBe('Sois bref.')
  })
})
