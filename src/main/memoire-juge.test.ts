import { describe, expect, it } from 'vitest'
import { memesReservesMineures, noteVerdictPrecedentPourJuge, reservesMineuresSeules, verdictPanelPourMemoire } from './memoire-juge'

const valideMineur = (...r: string[]) => `VALIDE\nSCORE: 84\nOBJECTIONS:\n${r.map((x) => `- MINEUR: ${x}`).join('\n')}\n- OK: tests verts`

// conv-35 : ~107 passages sur 109 apres validation, juge sans memoire + MINEUR repetes sans fin.
// fix-ok: conv-35 — la boucle juge-réparation relançait un passage quand le juge rendait VALIDE avec les MÊMES réserves MINEUR (107 passages sur 109 après validation) ; arrêt décidé par le code, jamais par le juge
describe('memoire du juge entre deux passages', () => {
  it('le rappel contient les objections du verdict precedent et exige de tout lister', () => {
    const note = noteVerdictPrecedentPourJuge(valideMineur('libelle /24 encore visible', 'test manquant sur HdeskTv'))
    expect(note).toContain('libelle /24 encore visible')
    expect(note).toContain('test manquant sur HdeskTv')
    expect(note).toMatch(/CHAQUE objection/)
    expect(note).toMatch(/TOUS les autres écarts/)
    expect(note).not.toContain('tests verts')
  })
  it('premier passage : aucun rappel', () => {
    expect(noteVerdictPrecedentPourJuge('')).toBe('')
  })
  it('memes reserves mineures (casse/accents/ordre ignores) = figees', () => {
    expect(memesReservesMineures(valideMineur('A détail', 'B'), valideMineur('b', 'a detail'))).toBe(true)
  })
  it('une reserve mineure NOUVELLE relance (conv-844 conservee)', () => {
    expect(memesReservesMineures(valideMineur('A', 'C'), valideMineur('A'))).toBe(false)
  })
  it('un MAJEUR, une puce nue ou un DEFAUT ne sont jamais traites comme mineurs', () => {
    expect(reservesMineuresSeules('VALIDE\nOBJECTIONS:\n- MAJEUR: x\n- MINEUR: y')).toBeNull()
    expect(reservesMineuresSeules('VALIDE\nOBJECTIONS:\n- x sans etiquette')).toBeNull()
    expect(reservesMineuresSeules('DEFAUT: x\nOBJECTIONS:\n- MINEUR: y')).toBeNull()
    expect(memesReservesMineures('DEFAUT: x\nOBJECTIONS:\n- MINEUR: y', 'DEFAUT: x\nOBJECTIONS:\n- MINEUR: y')).toBe(false)
  })
})

describe('verdictPanelPourMemoire', () => {
  it('reconstruit un VALIDE quand tous les membres ont valide, meme si le quorum a echoue', () => {
    const t = verdictPanelPourMemoire(
      ['VALIDE\nOBJECTIONS:\n- MINEUR: a', 'VALIDE\nOBJECTIONS:\n- MINEUR: b'],
      'DEFAUT: quorum non atteint (0/2 VALIDE, seuil 2)'
    )
    expect(reservesMineuresSeules(t)).toEqual(['a', 'b'])
  })
  it('garde le texte agrege si un membre a vraiment refuse', () => {
    const agrege = 'DEFAUT: quorum non atteint'
    expect(verdictPanelPourMemoire(['VALIDE\nOBJECTIONS:\n- MINEUR: a', 'DEFAUT: casse'], agrege)).toBe(agrege)
  })
})
