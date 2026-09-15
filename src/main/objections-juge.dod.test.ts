import { describe, expect, it } from 'vitest'
import { dodDuVerdict } from './objections-juge'
import { arretDeLaReparation, evaluateClosure, memeRefus } from './gates/stopgate'

// conv-539, tour 24e29815-0cbd-4310-8cda-93207e237015 : objections du juge absentes du refus.
const juge70 = 'VALIDE\nSCORE: 70\nOBJECTIONS:\n- Les ombres des panneaux se voient à peine.\n- Pas de capture du mode sombre.'
const juge68 = 'VALIDE\nSCORE: 68\nOBJECTIONS:\n- L\'effet wow reste modeste.'

describe('dodDuVerdict — les objections du juge entrent dans le refus', () => {
  it('nomme chaque objection dans les motifs du contrôle final', () => {
    const g = evaluateClosure({ status: 'red', dod: dodDuVerdict(false, juge70) })
    const texte = g.reasons.join(' ')
    expect(texte).toContain('Les ombres des panneaux se voient à peine.')
    expect(texte).toContain('Pas de capture du mode sombre.')
  })

  it("des objections qui changent ne sont pas un refus figé", () => {
    const a = evaluateClosure({ status: 'red', dod: dodDuVerdict(false, juge70) }).reasons
    const b = evaluateClosure({ status: 'red', dod: dodDuVerdict(false, juge68) }).reasons
    expect(memeRefus(b, a)).toBe(false)
    expect(
      arretDeLaReparation({
        tentative: 2,
        reparationsAccordees: 2,
        plafondDur: 24,
        motifsCourants: b,
        motifsPrecedents: a,
        refusIdentiquesConsecutifs: 0
      })
    ).toBeUndefined()
  })

  it('verdict vert : une case cochée, aucun motif', () => {
    expect(evaluateClosure({ status: 'green', dod: dodDuVerdict(true, 'VALIDE') }).blocked).toBe(false)
  })

  it('refus sans section OBJECTIONS : comportement antérieur conservé', () => {
    expect(dodDuVerdict(false, 'DEFAUT: rien ne compile')).toEqual([{ checked: false, hasContent: true }])
  })
})
