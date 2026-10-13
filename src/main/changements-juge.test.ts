import { describe, expect, it } from 'vitest'
import {
  lignesChangees,
  MAX_CARACTERES_CHANGEMENTS,
  noteChangementsPourJuge
} from './changements-juge'
import { AGGREGATE_MAX_CHARS } from './evidence-digest'

/**
 * Piste 1 de conv-914 : le juge d'une réparation reçoit ce qui a changé depuis le texte déjà jugé,
 * au lieu de revérifier tout le livrable sans savoir ce que la réparation a touché.
 */
describe('ce qui a changé entre deux passages du juge', () => {
  it('1er passage (rien de déjà jugé) : aucun bloc', () => {
    expect(noteChangementsPourJuge('', 'livrable')).toBe('')
  })

  it('2e passage : les lignes ajoutées et retirées, et rien des lignes inchangées', () => {
    const avant = '| piste | note |\n| 1 | 70 |\n| 2 | 50 |\nconclusion'
    const apres = '| piste | note |\n| 1 | 70 |\n| 2 | 55 |\nconclusion\nCausalHypothesis: x'
    const note = noteChangementsPourJuge(avant, apres)
    expect(note).toMatch(/^CE QUI A CHANGÉ/u)
    expect(note).toContain('+ | 2 | 55 |')
    expect(note).toContain('+ CausalHypothesis: x')
    expect(note).toContain('- | 2 | 50 |')
    expect(note).not.toContain('| 1 | 70 |')
    expect(note).not.toContain('conclusion')
  })

  it('une ligne répétée une fois de plus compte comme ajoutée (multiensemble)', () => {
    expect(lignesChangees('a\nb', 'a\nb\na')).toEqual({ ajoutees: ['a'], retirees: [] })
    expect(lignesChangees('a\na\nb', 'a\nb')).toEqual({ ajoutees: [], retirees: ['a'] })
  })

  it('texte identique : le bloc le dit au lieu de se taire', () => {
    expect(noteChangementsPourJuge('x\ny', 'x\ny')).toContain("aucune ligne du livrable n'a changé")
  })

  it('le bloc est borné et compte ce qu’il ne recopie pas', () => {
    const apres = Array.from(
      { length: 200 },
      (_, i) => `ligne ajoutée numéro ${i} ${'p'.repeat(60)}`
    ).join('\n')
    const note = noteChangementsPourJuge('ancien', apres)
    const lignesListees = note.split('\n').filter((l) => l.startsWith('+ ') || l.startsWith('- '))
    expect(lignesListees.join('\n').length).toBeLessThanOrEqual(MAX_CARACTERES_CHANGEMENTS)
    expect(note).toMatch(/… \d+ autre\(s\) ligne\(s\) changée\(s\), non recopiées/u)
    expect(lignesListees.length).toBeGreaterThan(0)
    expect(note.length).toBeLessThanOrEqual(MAX_CARACTERES_CHANGEMENTS)
  })

  it('le bloc ne fait jamais dépasser la taille maximale du livrable remis au juge', () => {
    const changees = Array.from({ length: 50 }, (_, i) => `nouvelle ligne ${i}`).join('\n')
    // Livrable presque au plafond (~2 000 caractères libres, plus qu'un en-tête mais moins que
    // MAX_CARACTERES_CHANGEMENTS) : le bloc prend la place restante, pas plus.
    const presquePlein = `${'v'.repeat(AGGREGATE_MAX_CHARS - 3000)}\n${changees}`
    expect(AGGREGATE_MAX_CHARS - presquePlein.length).toBeLessThan(MAX_CARACTERES_CHANGEMENTS)
    const note = noteChangementsPourJuge('ancien', presquePlein)
    expect(note).toMatch(/^CE QUI A CHANGÉ/u)
    expect(note.length + presquePlein.length).toBeLessThanOrEqual(AGGREGATE_MAX_CHARS)
    // Livrable déjà au plafond : aucune place, aucun bloc.
    expect(noteChangementsPourJuge('ancien', 'w'.repeat(AGGREGATE_MAX_CHARS))).toBe('')
  })
})
