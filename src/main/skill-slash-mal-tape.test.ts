import { describe, expect, it } from 'vitest'
import { corrigeSkillMalTapee, uneSeuleFauteDeFrappe } from '../shared/skill-aliases'
import { routeSkillRequest } from './skill-routing'
import { skillInstruction } from './skill-pipeline'

/**
 * Defaut vecu le 2026-09-04 (conv-257) : « /draf un bouton envoyer ... ».
 * Une lettre manquante => aucune skill resolue, corps JAMAIS injecte, et AUCUN signal :
 * l'agent a improvise une maquette hors des regles de `draft`.
 */
describe('slash mal tape', () => {
  it('mesure une seule faute, pas deux', () => {
    expect(uneSeuleFauteDeFrappe('draf', 'draft')).toBe(true)
    expect(uneSeuleFauteDeFrappe('drafte', 'draft')).toBe(true)
    expect(uneSeuleFauteDeFrappe('drqft', 'draft')).toBe(true)
    expect(uneSeuleFauteDeFrappe('draft', 'draft')).toBe(false)
    expect(uneSeuleFauteDeFrappe('dft', 'draft')).toBe(false)
  })

  it('ne devine pas quand deux skills sont a egalite', () => {
    expect(corrigeSkillMalTapee('buld', ['build', 'bold'])).toBeUndefined()
    expect(corrigeSkillMalTapee('draf', ['build', 'draft'])).toBe('draft')
  })

  it('route /draf comme la commande explicite draft', () => {
    const route = routeSkillRequest('/draf un bouton envoyer meilleur que cette merde')
    expect(route?.reason).toBe('explicit-skill')
    expect(route?.skill).toBe('draft')
  })

  it('injecte le corps de draft malgre la faute de frappe', () => {
    expect(skillInstruction('draf')).toContain('SKILL DRAFT')
  })
})
