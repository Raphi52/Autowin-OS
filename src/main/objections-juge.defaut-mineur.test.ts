import { describe, expect, it } from 'vitest'
import { dodDuVerdict, verdictAvecObjectionsPortees } from './objections-juge'

// conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb, reparation 4 : le juge objecte qu'une etiquette
// MINEUR posee par le juge lui-meme peut affaiblir le controle. Borne : elle ne vaut que sur un VALIDE.
describe('etiquette MINEUR bornee au verdict VALIDE', () => {
  const defaut = 'DEFAUT: capture absente\nSCORE: 55\nOBJECTIONS:\n- MINEUR: aucune capture du mode sombre\n- OK: tests verts'

  it('un DEFAUT dont les puces sont MINEUR reste rouge ET porte ses raisons a la reparation', () => {
    expect(verdictAvecObjectionsPortees(defaut)).toMatch(/^DEFAUT:/)
    const dod = dodDuVerdict(false, defaut)
    expect(dod.every((c) => !c.checked)).toBe(true)
    expect(dod.map((c) => c.label ?? '').join('\n')).toContain('aucune capture du mode sombre')
  })

  it('un VALIDE dont les puces sont MINEUR/OK reste une cloture', () => {
    const valide = 'VALIDE\nSCORE: 80\nOBJECTIONS:\n- MINEUR: libelle perfectible\n- OK: 12/12 tests'
    expect(verdictAvecObjectionsPortees(valide)).toBe(valide)
  })

  // Tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb, reparation 8 : juge « VALIDE SCORE 74 », puces toutes MINEUR/OK,
  // mais rouge venu de la preuve (Échec déjà déclaré) → le refus listait les MINEUR/OK comme « Promis mais pas fait ».
  it('un VALIDE rouge pour une AUTRE raison ne transforme pas ses MINEUR/OK en raisons de refus', () => {
    const valide = "Je vérifie.\n\nVALIDE\nSCORE: 74\nOBJECTIONS:\n- MINEUR: seuil non mesure\n- OK: 261 tests"
    expect(dodDuVerdict(false, valide)).toEqual([{ checked: false, hasContent: true }])
  })
})
