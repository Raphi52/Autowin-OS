import { describe, expect, it } from 'vitest'
import { objectionsDuJuge, verdictAvecObjectionsPortees } from './objections-juge'
import { lireVerdictJuge } from './orchestrator'

describe('objectionsDuJuge', () => {
  it('rend les objections concrètes de la section', () => {
    expect(
      objectionsDuJuge('VALIDE\nSCORE: 80\nOBJECTIONS:\n- test manquant sur X\n- preuve absente')
    ).toEqual(['test manquant sur X', 'preuve absente'])
  })

  it('traite « aucune » comme vide', () => {
    expect(objectionsDuJuge('VALIDE\nSCORE: 95\nOBJECTIONS:\n- aucune')).toEqual([])
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS: aucune')).toEqual([])
    expect(objectionsDuJuge('VALIDE')).toEqual([])
  })

  it('s’arrête à la section suivante', () => {
    expect(objectionsDuJuge('OBJECTIONS:\n- a\nSCORE: 10\n- pas une objection')).toEqual(['a'])
  })
})

describe('verdictAvecObjectionsPortees', () => {
  it('transforme un VALIDE porteur d’objections en refus lisible', () => {
    const porte = verdictAvecObjectionsPortees('VALIDE\nOBJECTIONS:\n- test manquant sur X')
    expect(lireVerdictJuge(porte)).toBe(false)
    expect(porte).toContain('test manquant sur X')
  })

  it('laisse intact un vert sans objection et un défaut déjà lisible', () => {
    expect(verdictAvecObjectionsPortees('VALIDE\nOBJECTIONS:\n- aucune')).toBe(
      'VALIDE\nOBJECTIONS:\n- aucune'
    )
    const defaut = 'DEFAUT: raison\nOBJECTIONS:\n- x'
    expect(verdictAvecObjectionsPortees(defaut)).toBe(defaut)
  })
})
