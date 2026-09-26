import { describe, expect, it } from 'vitest'
import { CLOSURE_UPSTREAM_REFUSAL, arretDeLaReparation, memeRefus } from './stopgate'

/**
 * UN REFUS MIXTE FIGÉ doit aussi couper la boucle.
 *
 * Défaut VÉCU, conv-470, tour `52fbe05f-0086-4806-8f07-c8762e8caa35` (demande `/kaizen j'ai rien en
 * préprompt`, saisie `ts=1789192601300`) : QUATRE passages `[RÉPARATION 1..4]`, chacun suivi du même
 * refus mot pour mot — « Échec déjà déclaré … ; Promis mais pas fait : "Cible nommee …
 * src/main/model-quotas.ts" ». `doitArreterLaReparation` n'a pas mordu parce qu'elle exige que TOUS
 * les motifs soient hors de portée de build : la promesse non tenue passait pour réparable. Elle ne
 * l'était pas — le fichier exigé venait du dossier de preuve joint, pas de la demande — et quatre
 * builds + panels de juge ont été payés pour un refus qui ne bougeait pas.
 *
 * La règle ajoutée ne touche pas au premier constat : un refus mixte garde ses passages de
 * réparation. Elle coupe quand il s'est AVÉRÉ figé, c'est-à-dire répété à l'identique plusieurs fois
 * de suite.
 */
describe('réparation — refus mixte figé', () => {
  const refusMixte = [
    CLOSURE_UPSTREAM_REFUSAL,
    'Promis mais pas fait : « Cible nommee dans la demande reellement modifiee : src/main/model-quotas.ts ».'
  ]

  it('laisse passer le premier refus identique mixte (il reste peut-être réparable)', () => {
    expect(
      arretDeLaReparation({
        tentative: 1,
        reparationsAccordees: 2,
        plafondDur: 24,
        motifsCourants: refusMixte,
        motifsPrecedents: refusMixte,
        refusIdentiquesConsecutifs: 1
      })
    ).toBeUndefined()
  })

  it('coupe quand le MÊME refus mixte revient une deuxième fois de suite', () => {
    const motif = arretDeLaReparation({
      tentative: 2,
      reparationsAccordees: 2,
      plafondDur: 24,
      motifsCourants: refusMixte,
      motifsPrecedents: refusMixte,
      refusIdentiquesConsecutifs: 2
    })
    expect(motif).toMatch(/même refus/)
    expect(motif).toMatch(/2 fois/)
  })

  it('ne coupe pas si le refus a CHANGÉ, quel que soit le compteur', () => {
    expect(
      arretDeLaReparation({
        tentative: 3,
        reparationsAccordees: 2,
        plafondDur: 24,
        motifsCourants: ['Promis mais pas fait : « Analyse demandee presente ».'],
        motifsPrecedents: refusMixte,
        refusIdentiquesConsecutifs: 0
      })
    ).toBeUndefined()
  })
})

describe('memeRefus — la comparaison que la boucle utilise pour compter', () => {
  it('dit non au tout premier refus (aucun précédent)', () => {
    expect(memeRefus(['a'], [])).toBe(false)
  })
  it('dit oui sur un refus identique mot pour mot', () => {
    expect(memeRefus(['a', 'b'], ['a', 'b'])).toBe(true)
  })
  it('dit non dès qu’un motif change ou s’ajoute', () => {
    expect(memeRefus(['a', 'c'], ['a', 'b'])).toBe(false)
    expect(memeRefus(['a', 'b', 'c'], ['a', 'b'])).toBe(false)
  })
})
