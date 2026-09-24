import { describe, expect, it } from 'vitest'
import { objectionsDuJuge, verdictAvecObjectionsPortees, dodDuVerdict } from './objections-juge'

// conv-844 (2026-09-24) : run kaizen-…-mufvgag5 clos « succeeded » sur un VALIDE 82 dont une puce
// MINEUR etait un vrai trou. Decision utilisateur : tout defaut du juge, meme MINEUR, bloque la
// cloture verte. Seuls les constats OK passent (remplace la regle de la saisie ts 1789462078031).
describe('une objection MINEUR bloque un VALIDE ; seul OK passe', () => {
  const texte =
    'VALIDE\nSCORE: 74\nOBJECTIONS:\n- MINEUR: le seuil de 3 n\'est pas mesure\n- OK: 54 sur 54 tests passent'
  it('un VALIDE avec une puce MINEUR devient un refus portant cette puce', () => {
    expect(objectionsDuJuge(texte)).toEqual(["le seuil de 3 n'est pas mesure"])
    expect(verdictAvecObjectionsPortees(texte)).toMatch(/^DEFAUT:/)
  })
  it('un VALIDE dont les puces sont toutes OK reste vert', () => {
    const vert = 'VALIDE\nSCORE: 90\nOBJECTIONS:\n- OK: 54 sur 54 tests passent'
    expect(objectionsDuJuge(vert)).toEqual([])
    expect(verdictAvecObjectionsPortees(vert)).toBe(vert)
  })
  it('une puce MAJEUR ou non etiquetee bloque toujours', () => {
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- MAJEUR: aucun test\n- MINEUR: style')).toEqual(['aucun test', 'style'])
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- preuve absente')).toEqual(['preuve absente'])
    expect(dodDuVerdict(false, 'DEFAUT: x\nOBJECTIONS:\n- **MINEUR** : style\n- MAJEUR: y')).toHaveLength(2)
  })
})
