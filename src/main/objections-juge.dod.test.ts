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
    // Arbitrage conv-539 (tour 82a4f5d1-d92f-4d73-9f6f-cac70db65ecb, reparation 16) : ce test
    // exigeait memeRefus=false quand seules les objections citees changent. La decision terrain
    // POSTERIEURE d89e950b (conv-540, tour 4dfe2821-f6da-4cd9-8cb8-7afba10d3df4) neutralise
    // justement ces citations, sinon une boucle figee ne coupait jamais. Les deux regles ne peuvent
    // pas coexister : la mesure terrain l'emporte. Ce qui compte ici reste vrai et reste teste :
    // un refus dont les citations changent NE STOPPE PAS la reparation au 2e passage.
    expect(memeRefus(b, a)).toBe(true)
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

describe('objectionsDuJuge — « Aucune capture … » est une objection, pas le vide', () => {
  it('garde une objection qui commence par Aucune', async () => {
    const { objectionsDuJuge } = await import('./objections-juge')
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- Aucune capture du mode sombre.')).toEqual([
      'Aucune capture du mode sombre.'
    ])
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- aucune')).toEqual([])
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS: aucune objection.')).toEqual([])
    expect(objectionsDuJuge('VALIDE\nOBJECTIONS:\n- RAS')).toEqual([])
  })
})
