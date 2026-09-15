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
  // Arbitrage conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb : la puce est marquée MAJEUR.
  // La protection testée est la même — une objection majeure non levée retourne un VALIDE en refus —
  // mais un juge qui n'étiquette RIEN garde son verdict (voir le describe plus bas).
  it('transforme un VALIDE porteur d’objections en refus lisible', () => {
    const porte = verdictAvecObjectionsPortees('VALIDE\nOBJECTIONS:\n- MAJEUR: test manquant sur X')
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

describe('juge qui valide sans étiqueter aucune puce', () => {
  // conv-539 tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb, réparations 17 à 19 : le juge rend
  // « VALIDE / SCORE 72 » avec des puces NON étiquetées, dont des constats vérifiés (« 284 tests,
  // tous verts »). Non étiqueté = MAJEUR : son propre VALIDE était retourné en DEFAUT, le tour
  // repartait en réparation, et le refus « Promis mais pas fait » recitait ces mêmes constats.
  // Saisie ts 1789462078031 : le tour doit finir quand les juges n'ont plus de défaut MAJEUR.
  const valideNonEtiquete =
    'VALIDE\nSCORE: 72\nOBJECTIONS:\n- Les preuves tiennent, je les ai revérifiées : 284 tests, tous verts.\n- Beaucoup de passages pour peu de progrès visible.'

  it('garde son VALIDE quand il n’a étiqueté aucune puce', () => {
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(valideNonEtiquete))).toBe(true)
  })

  it('bloque toujours dès qu’une puce est marquée MAJEUR', () => {
    const avecMajeur = valideNonEtiquete.replace('- Beaucoup', '- MAJEUR: Beaucoup')
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(avecMajeur))).toBe(false)
  })

  it('bloque toujours un juge qui étiquette et laisse une puce nue', () => {
    const melange = valideNonEtiquete.replace('- Les preuves', '- OK: Les preuves')
    expect(lireVerdictJuge(verdictAvecObjectionsPortees(melange))).toBe(false)
  })
})
