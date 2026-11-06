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

/*
 * fix-ok: run-0940cc5e0fcd-1 (conv-857, 2026-09-26), reparation 13 (rouge 2/5 avant le correctif) : le juge rend « VALIDE / SCORE 86 ». Sa puce
 * « OK: Chaque correction annoncee existe dans le code : » porte 9 SOUS-puces indentees, toutes des
 * constats. Sans etiquette propre, elles etaient retenues comme objections : le controle final a
 * recite 8 d'entre elles en « Promis mais pas fait » (slice 0..8) et masque les 4 vraies reserves MINEUR.
 */
describe("une sous-puce herite de l'etiquette de sa puce parente", () => {
  const verdict = [
    'VALIDE',
    'SCORE: 86',
    'OBJECTIONS:',
    '- OK: Chaque correction annoncee existe dans le code :',
    "  - le filtre anti-incident ne s'applique plus aux mails (`watchdog-engine.ts:423`) ;",
    '  - le reglage `newSenders` existe ;',
    "- OK: La capture existe, et je l'ai ouverte.",
    "- MINEUR: La n°2 (Teams) n'est pas verifiee de bout en bout.",
    '- MINEUR: Trois changements de comportement :',
    '  - Teams ne se connecte plus que sur clic.'
  ].join('\n')

  it("les sous-puces d'un OK ne deviennent pas des promesses non tenues", () => {
    expect(objectionsDuJuge(verdict)).toEqual([
      "La n°2 (Teams) n'est pas verifiee de bout en bout.",
      'Trois changements de comportement :',
      'Teams ne se connecte plus que sur clic.'
    ])
    const libelles = dodDuVerdict(false, verdict).map((d) => d.label ?? '')
    expect(libelles.join('\n')).not.toMatch(/filtre anti-incident|newSenders/)
    expect(libelles.join('\n')).toMatch(/n°2 \(Teams\)/)
  })

  it('sous un MAJEUR, une sous-puce reste un defaut meme quand les puces nues sont des constats', () => {
    const texte = 'DEFAUT: x\nOBJECTIONS:\n- MAJEUR: deux trous :\n  - pas de test\n- constat nu'
    expect(objectionsDuJuge(texte)).toEqual(['deux trous :', 'pas de test'])
  })
})
