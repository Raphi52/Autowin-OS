/**
 * LE WORKFLOW INTELLIGENT, PISTE PAR PISTE — demandes du 2026-10-22 (conv-1080) : « parfois y a pas
 * besoin du workflow complet », puis « fais le truc parfait ».
 *
 * Entrées qui tuent un choix faux : chaque raison de garder le workflow complet est exercée SEULE sur
 * une piste qui, sans elle, serait directe — sinon un test vert ne prouverait pas que c'est CETTE
 * raison qui tranche. Le plan est ensuite exercé sur les cas mesurés : sélection mixte (26 sur 49)
 * et grosse sélection (16 runs coupés par la limite de session, 6 pistes en moyenne).
 */
import { describe, expect, it } from 'vitest'
import { lotDeLaSelection, voieDeLaSelection } from '../../../shared/selection-scout'
import {
  MAX_PISTES_PAR_LOT,
  motifDuLot,
  planDeLancement,
  redigerPromptCorrectionDirecte,
  redigerPromptSelon,
  redigerPromptsDuPlan,
  redigerPromptWorkflowSelection,
  resumeDuPlan,
  voieDeLaPiste,
  type CandidatAffiche
} from './veille-candidats-message'

const correction = (surcharge: Partial<CandidatAffiche> = {}): CandidatAffiche => ({
  titre: 'Le compteur ne se remet pas à zéro',
  type: 'fix',
  effort: 'g',
  url: 'src/main/compteur.ts:42',
  ...surcharge
})
const ajout = (titre: string): CandidatAffiche => ({ titre, type: 'new', effort: 'y' })

describe('voieDeLaPiste', () => {
  it('une correction localisée, effort contenu → correction directe', () => {
    expect(voieDeLaPiste(correction()).voie).toBe('directe')
  })

  it('le vocabulaire de la veille (« correction ») vaut « fix »', () => {
    expect(voieDeLaPiste(correction({ type: 'correction' })).voie).toBe('directe')
  })

  it('une commande de preuve suffit à localiser une piste sans ancrage', () => {
    const voie = voieDeLaPiste(
      correction({ url: undefined, commande: 'npx vitest run src/a.test.ts' })
    )
    expect(voie.voie).toBe('directe')
    expect(voie.motif).toContain('preuve')
  })

  it('un ancrage écrit dans le « Comment » compte aussi', () => {
    expect(
      voieDeLaPiste(correction({ url: undefined, how: 'Borner la boucle de src/a.ts:12.' })).voie
    ).toBe('directe')
  })

  it('un ajout se cadre : workflow complet', () => {
    const { voie, motif } = voieDeLaPiste(correction({ type: 'new' }))
    expect(voie).toBe('complete')
    expect(motif).toContain('ajout')
  })

  it('une nature inconnue garde le workflow complet', () => {
    expect(voieDeLaPiste(correction({ type: undefined })).voie).toBe('complete')
  })

  it('un effort fort garde le workflow complet', () => {
    expect(voieDeLaPiste(correction({ effort: 'r' })).voie).toBe('complete')
  })

  it('un signal de risque garde le workflow complet — le même motif que classifyRegime', () => {
    const { voie, motif } = voieDeLaPiste(
      correction({ why: 'La migration du schéma casse les anciens fils.' })
    )
    expect(voie).toBe('complete')
    expect(motif).toContain('risque')
  })

  it('un signal de risque NIÉ ne compte pas', () => {
    expect(voieDeLaPiste(correction({ how: 'Corriger sans migration.' })).voie).toBe('directe')
  })

  it('une piste non localisée garde le workflow complet', () => {
    expect(voieDeLaPiste(correction({ url: undefined })).voie).toBe('complete')
  })

  it('une URL web n’est pas une localisation de code', () => {
    expect(voieDeLaPiste(correction({ url: 'https://exemple.fr/article:2024' })).voie).toBe(
      'complete'
    )
  })
})

describe('planDeLancement', () => {
  it('une sélection MIXTE ne bascule plus entière dans le complet : deux lots, un par voie', () => {
    const plan = planDeLancement([ajout('Vue des coûts'), correction(), ajout('Export CSV')])
    expect(plan.map((lot) => lot.voie)).toEqual(['directe', 'complete'])
    expect(plan[0]!.positions).toEqual([1])
    expect(plan[1]!.positions).toEqual([0, 2])
  })

  it('les corrections directes partent en premier, dans l’ordre du scout', () => {
    const plan = planDeLancement([
      ajout('A'),
      correction({ titre: 'B' }),
      correction({ titre: 'C' })
    ])
    expect(plan[0]!.candidats.map((c) => c.titre)).toEqual(['B', 'C'])
  })

  it(`jamais plus de ${MAX_PISTES_PAR_LOT} pistes par lot, en lots équilibrés`, () => {
    const sept = [1, 2, 3, 4, 5, 6, 7].map((n) => ajout(`Piste ${n}`))
    expect(planDeLancement(sept).map((lot) => lot.positions.length)).toEqual([3, 2, 2])
    const quatre = sept.slice(0, 4)
    expect(planDeLancement(quatre).map((lot) => lot.positions.length)).toEqual([2, 2])
  })

  it('chaque piste part une fois et une seule', () => {
    const selection = [
      ...[1, 2, 3, 4].map((n) => correction({ titre: `Fix ${n}` })),
      ...[1, 2, 3, 4, 5].map((n) => ajout(`Ajout ${n}`))
    ]
    const positions = planDeLancement(selection).flatMap((lot) => lot.positions)
    expect([...positions].sort((a, b) => a - b)).toEqual(selection.map((_, rang) => rang))
  })

  it('aucune piste : aucun lot', () => {
    expect(planDeLancement([])).toEqual([])
  })

  it('le motif nomme la piste quand le lot complet n’en a qu’une', () => {
    const [lot] = planDeLancement([ajout('Vue des coûts')])
    expect(motifDuLot(lot!)).toContain('« Vue des coûts »')
    expect(motifDuLot(lot!)).toContain('ajout')
  })

  it('le résumé dit le nombre de lots et leur voie', () => {
    expect(resumeDuPlan(planDeLancement([correction()]))).toBe('en correction directe')
    expect(
      resumeDuPlan(planDeLancement([correction(), ajout('A'), ajout('B'), ajout('C'), ajout('D')]))
    ).toBe('en 3 lots à la suite (1 en correction directe, 2 en workflow complet)')
  })
})

describe('redigerPromptsDuPlan', () => {
  const plan = planDeLancement([ajout('Vue des coûts'), correction(), ajout('Export CSV')])
  const prompts = redigerPromptsDuPlan(plan)

  it('un message par lot, la voie de chacun en tête', () => {
    expect(prompts).toHaveLength(2)
    expect(prompts[0]!.split('\n')[0]).toBe('/build')
    expect(prompts[1]!.startsWith('Traite ENSEMBLE ces 2 candidats')).toBe(true)
  })

  it('chaque message ne porte QUE ses pistes', () => {
    expect(prompts[0]).toContain('Le compteur ne se remet pas à zéro')
    expect(prompts[0]).not.toContain('Vue des coûts')
    expect(prompts[1]).toContain('Vue des coûts')
    expect(prompts[1]).toContain('Export CSV')
    expect(prompts[1]).not.toContain('Le compteur')
  })

  it('chaque message dit sa place, lisible par la mémoire du scout', () => {
    expect(lotDeLaSelection(prompts[0])).toEqual({ numero: 1, total: 2 })
    expect(lotDeLaSelection(prompts[1])).toEqual({ numero: 2, total: 2 })
    expect(prompts[1]).toContain('ne les traite pas ici')
  })

  it('la voie se relit sur le message, comme la mémoire du scout la notera', () => {
    expect(voieDeLaSelection(prompts[0])).toBe('directe')
    expect(voieDeLaSelection(prompts[1])).toBe('complete')
  })

  it('une sélection d’un seul lot ne parle pas de lots', () => {
    const [seul] = redigerPromptsDuPlan(planDeLancement([correction()]))
    expect(seul).not.toMatch(/Lot \d/u)
    expect(lotDeLaSelection(seul)).toBeNull()
  })
})

describe('redigerPromptCorrectionDirecte', () => {
  const prompt = redigerPromptCorrectionDirecte([
    correction({ commande: 'npx vitest run src/main/compteur.test.ts' })
  ])

  it('nomme la phase build en première ligne, seule', () => {
    expect(prompt.split('\n')[0]).toBe('/build')
  })

  it('garde l’en-tête, la piste, son ancrage et sa preuve', () => {
    expect(prompt).toContain('Traite ce candidat issu du scout interne d')
    expect(prompt).toContain('Le compteur ne se remet pas à zéro — ancrage src/main/compteur.ts:42')
    expect(prompt).toContain('Preuve à lancer : npx vitest run src/main/compteur.test.ts')
  })

  it('garde le même contrat de fin que le workflow complet', () => {
    expect(prompt).toContain('COMMIT PUBLIÉ')
  })

  it('ne demande plus le pipeline complet', () => {
    expect(prompt).not.toMatch(/pipeline/iu)
  })
})

describe('redigerPromptSelon', () => {
  it('aiguille chaque voie vers son message', () => {
    const selection = [correction()]
    expect(redigerPromptSelon('directe', selection)).toBe(redigerPromptCorrectionDirecte(selection))
    expect(redigerPromptSelon('complete', selection)).toBe(
      redigerPromptWorkflowSelection(selection)
    )
  })
})

describe('voieDeLaSelection', () => {
  it('« /build » cité DANS une piste n’en fait pas une correction directe', () => {
    const prompt = redigerPromptWorkflowSelection([
      ajout('Documenter la commande /build traite tout')
    ])
    expect(voieDeLaSelection(prompt)).toBe('complete')
  })

  it('une demande libre n’a pas de voie', () => {
    expect(voieDeLaSelection('/build corrige le compteur')).toBeNull()
  })
})
