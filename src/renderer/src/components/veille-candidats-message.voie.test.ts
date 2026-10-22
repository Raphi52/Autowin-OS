/**
 * QUELLE VOIE POUR LA SÉLECTION ? — demande du 2026-10-22 (conv-1080) : « après un scout ça me propose
 * toujours lancer le workflow complet… mais parfois y a pas besoin du workflow complet ».
 *
 * Entrées qui tuent une recommandation fausse : chaque raison de garder le workflow complet est
 * exercée SEULE sur une piste qui, sans elle, serait directe — sinon un test vert ne prouverait pas
 * que c'est CETTE raison qui tranche.
 */
import { describe, expect, it } from 'vitest'
import {
  redigerPromptCorrectionDirecte,
  redigerPromptSelon,
  redigerPromptWorkflowSelection,
  voieRecommandee,
  type CandidatAffiche
} from './veille-candidats-message'

const correction = (surcharge: Partial<CandidatAffiche> = {}): CandidatAffiche => ({
  titre: 'Le compteur ne se remet pas à zéro',
  type: 'fix',
  effort: 'g',
  url: 'src/main/compteur.ts:42',
  ...surcharge
})

describe('voieRecommandee', () => {
  it('une correction localisée, effort contenu → correction directe', () => {
    expect(voieRecommandee([correction()]).voie).toBe('directe')
    expect(voieRecommandee([correction(), correction({ titre: 'Autre' })]).voie).toBe('directe')
  })

  it('le vocabulaire de la veille (« correction ») vaut « fix »', () => {
    expect(voieRecommandee([correction({ type: 'correction' })]).voie).toBe('directe')
  })

  it('une commande de preuve suffit à localiser une piste sans ancrage', () => {
    expect(
      voieRecommandee([correction({ url: undefined, commande: 'npx vitest run src/a.test.ts' })])
        .voie
    ).toBe('directe')
  })

  it('un ancrage écrit dans le « Comment » compte aussi', () => {
    expect(
      voieRecommandee([correction({ url: undefined, how: 'Borner la boucle de src/a.ts:12.' })])
        .voie
    ).toBe('directe')
  })

  it('un ajout se cadre : workflow complet', () => {
    const { voie, motif } = voieRecommandee([correction({ type: 'new' })])
    expect(voie).toBe('complete')
    expect(motif).toContain('ajout')
  })

  it('une nature inconnue garde le workflow complet', () => {
    expect(voieRecommandee([correction({ type: undefined })]).voie).toBe('complete')
  })

  it('un effort fort garde le workflow complet', () => {
    expect(voieRecommandee([correction({ effort: 'r' })]).voie).toBe('complete')
  })

  it('un signal de risque garde le workflow complet — le même motif que classifyRegime', () => {
    const { voie, motif } = voieRecommandee([
      correction({ why: 'La migration du schéma casse les anciens fils.' })
    ])
    expect(voie).toBe('complete')
    expect(motif).toContain('risque')
  })

  it('un signal de risque NIÉ ne compte pas', () => {
    expect(voieRecommandee([correction({ how: 'Corriger sans migration.' })]).voie).toBe('directe')
  })

  it('une piste non localisée garde le workflow complet', () => {
    expect(voieRecommandee([correction({ url: undefined })]).voie).toBe('complete')
  })

  it('une URL web n’est pas une localisation de code', () => {
    expect(voieRecommandee([correction({ url: 'https://exemple.fr/article:2024' })]).voie).toBe(
      'complete'
    )
  })

  it('plus de 3 pistes ensemble = un chantier', () => {
    const quatre = [1, 2, 3, 4].map((n) => correction({ titre: `Piste ${n}` }))
    expect(voieRecommandee(quatre.slice(0, 3)).voie).toBe('directe')
    expect(voieRecommandee(quatre).voie).toBe('complete')
  })

  it('UNE piste douteuse suffit à garder le complet pour toute la sélection', () => {
    expect(voieRecommandee([correction(), correction({ type: 'new' })]).voie).toBe('complete')
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
