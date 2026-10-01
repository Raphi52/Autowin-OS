import { describe, expect, it } from 'vitest'
import { anglesDuPanelScout, PERSONAS, personaInstruction, personasFor } from './persona'

/**
 * Le piège que ces tests existent pour fermer : une persona AFFICHÉE mais jamais injectée. On aurait
 * alors trois angles à l'écran et trois prompts identiques envoyés — un fan-out qui coûte trois fois
 * le prix pour rendre trois fois le même avis, en donnant l'illusion inverse.
 */

describe('injection de la persona', () => {
  it('deux personas produisent deux blocs DIFFÉRENTS — sinon le fan-out ne sert à rien', () => {
    const a = personaInstruction('correcteur')
    const b = personaInstruction('gardien')
    expect(a).not.toBe('')
    expect(b).not.toBe('')
    expect(a).not.toBe(b)
  })

  it('une persona du catalogue injecte SON instruction, pas son identifiant', () => {
    const bloc = personaInstruction('lean')
    expect(bloc).toContain('sur-ingénierie')
    // L'id seul n'apprendrait rien au modèle : c'est l'instruction qui porte l'angle.
    expect(bloc).not.toMatch(/^\s*lean\s*$/)
  })

  it('un angle libre hors catalogue est injecté tel quel', () => {
    expect(personaInstruction('Tu ne regardes que les fuites mémoire.')).toContain(
      'fuites mémoire'
    )
  })

  it('pas de persona → aucun bloc, le prompt reste celui d’avant', () => {
    expect(personaInstruction()).toBe('')
    expect(personaInstruction('')).toBe('')
    expect(personaInstruction('   ')).toBe('')
  })

  it('chaque bloc rappelle que l’angle est EXCLUSIF', () => {
    for (const persona of Object.values(PERSONAS).flat()) {
      expect(personaInstruction(persona.id)).toContain('CET angle')
    }
  })

  it('les identifiants sont uniques sur tout le catalogue', () => {
    const ids = Object.values(PERSONAS)
      .flat()
      .map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('un panel scout reçoit un angle distinct par membre, le web en premier', () => {
    const panel = anglesDuPanelScout([{ model: 'a' }, { model: 'b' }, { model: 'c' }])
    expect(panel.map((m) => m.persona)).toEqual(['externe', 'rupture', 'usage'])
    // Le web existe comme angle, et son bloc dit de citer une URL datée.
    expect(personaInstruction('externe')).toMatch(/URL/u)
    expect(personaInstruction('externe')).toMatch(/30 à 90/u)
  })

  it('un angle déjà posé est gardé et n’est pas redistribué ; un membre seul reste tel quel', () => {
    const panel = anglesDuPanelScout([{ persona: 'externe' }, {}, {}])
    expect(panel.map((m) => m.persona)).toEqual(['externe', 'rupture', 'usage'])
    expect(anglesDuPanelScout([{ model: 'seul' }])).toEqual([{ model: 'seul' }])
    expect(anglesDuPanelScout([])).toEqual([])
  })

  it('au-delà du catalogue, la répartition reboucle sans laisser de membre sans angle', () => {
    const panel = anglesDuPanelScout(Array.from({ length: 7 }, () => ({})))
    expect(panel.every((m) => Boolean(m.persona))).toBe(true)
    expect(new Set(panel.slice(0, 5).map((m) => m.persona)).size).toBe(5)
  })

  it('une phase sans catalogue rend une liste vide, jamais une erreur', () => {
    expect(personasFor('clean')).toEqual([])
    expect(personasFor('judge').length).toBeGreaterThan(1)
  })
})
