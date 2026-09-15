import { describe, expect, it } from 'vitest'
import { objectionsDuJuge, verdictAvecObjectionsPortees, dodDuVerdict } from './objections-juge'

// conv-539, tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb, reparation 3 : juge « VALIDE SCORE 74 » dont
// la 1re puce etait « Ce que j'ai verifie moi-meme : ... 54 sur 54 passent » -> transformee en
// « Promis mais pas fait » et tour rouge. Saisie ts 1789462078031 : finir quand plus de defaut MAJEUR.
describe('objections MINEUR / constats ne bloquent pas un VALIDE', () => {
  const texte =
    'VALIDE\nSCORE: 74\nOBJECTIONS:\n- MINEUR: le seuil de 3 n\'est pas mesure\n- OK: 54 sur 54 tests passent'
  it('un VALIDE sans puce majeure reste vert', () => {
    expect(objectionsDuJuge(texte)).toEqual([])
    expect(verdictAvecObjectionsPortees(texte)).toBe(texte)
  })
  it('une puce MAJEUR ou non etiquetee bloque toujours', () => {
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- MAJEUR: aucun test\n- MINEUR: style')).toEqual(['aucun test'])
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- preuve absente')).toEqual(['preuve absente'])
    expect(dodDuVerdict(false, 'DEFAUT: x\nOBJECTIONS:\n- **MINEUR** : style\n- MAJEUR: y')).toHaveLength(1)
  })
})
