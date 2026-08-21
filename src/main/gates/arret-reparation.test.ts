import { describe, expect, it } from 'vitest'
import { CLOSURE_UPSTREAM_REFUSAL, arretDeLaReparation } from './stopgate'

/**
 * QUAND s'arrête-t-on de réparer — et pourquoi le compte ne doit plus décider seul.
 *
 * La boucle avait trois sorties : le succès, la règle de non-progrès… et l'épuisement du compte,
 * SILENCIEUX. Un run rendait donc « bloqué » sans dire s'il avait renoncé faute de progrès ou faute
 * de tours — deux causes qui n'envoient pas chercher au même endroit. La contrainte est explicite :
 * une borne qui mord doit se DIRE.
 *
 * Le renversement : le PROGRÈS décide, le compte devient un garde-fou de dernier ressort. Un run dont
 * les refus changent à chaque passage progresse — l'arrêter parce qu'un compteur est arrivé au bout
 * est ce que l'utilisateur reprochait. Un run dont le refus est identique ET hors de portée de
 * `build` ne peut rien changer : lui, on l'arrête tout de suite (mesuré conv-1242 : 3 passages, le
 * même refus mot pour mot, 2 min brûlées).
 */
describe('arrêt de la réparation', () => {
  // La VRAIE constante, importée : ma première version en inventait le texte, et le test passait à
  // côté de la règle (`doitArreterLaReparation` compare à cette valeur exacte).
  const refusA = [CLOSURE_UPSTREAM_REFUSAL]
  const refusB = ['Promis mais pas fait : « Analyse demandee presente dans le livrable ».']

  it('continue quand le refus CHANGE, même au-delà du nombre de réparations accordées', () => {
    // C'est le renversement demandé : le progrès l'emporte sur le compte.
    expect(
      arretDeLaReparation({
        tentative: 5,
        reparationsAccordees: 2,
        plafondDur: 10,
        motifsCourants: refusB,
        motifsPrecedents: refusA
      })
    ).toBeUndefined()
  })

  it('s’arrête sur un refus IDENTIQUE et hors de portée de build, dès le premier constat', () => {
    const motif = arretDeLaReparation({
      tentative: 1,
      reparationsAccordees: 5,
      plafondDur: 10,
      motifsCourants: refusA,
      motifsPrecedents: refusA
    })
    expect(motif).toContain('hors de portée')
  })

  it('un refus identique mais RÉPARABLE ne suffit pas à arrêter', () => {
    expect(
      arretDeLaReparation({
        tentative: 1,
        reparationsAccordees: 5,
        plafondDur: 10,
        motifsCourants: refusB,
        motifsPrecedents: refusB
      })
    ).toBeUndefined()
  })

  it('un refus MIXTE (amont + une raison réparable) ne s’arrête PAS', () => {
    /**
     * Combinaison signalée par un relecteur externe comme prouvée par lecture de code seulement.
     * La règle est explicite : on ne coupe que si AUCUNE raison n'est réparable par build. Un refus
     * qui AJOUTE une raison réparable au refus amont reste donc rejouable — et la longueur inégale
     * suffit déjà à faire échouer le test d'identité.
     */
    expect(
      arretDeLaReparation({
        tentative: 1,
        reparationsAccordees: 5,
        plafondDur: 10,
        motifsCourants: [...refusA, 'Promis mais pas fait : « Analyse demandee presente ».'],
        motifsPrecedents: refusA
      })
    ).toBeUndefined()
  })

  it('le plafond DUR mord, et il le DIT — c’est ce qui manquait', () => {
    const motif = arretDeLaReparation({
      tentative: 10,
      reparationsAccordees: 2,
      plafondDur: 10,
      motifsCourants: refusB,
      motifsPrecedents: refusA
    })
    expect(motif).toBeDefined()
    expect(motif).toContain('plafond')
    expect(motif).toContain('10')
  })

  it('sans passage précédent (première tentative), on ne conclut jamais au non-progrès', () => {
    expect(
      arretDeLaReparation({
        tentative: 1,
        reparationsAccordees: 1,
        plafondDur: 10,
        motifsCourants: refusA,
        motifsPrecedents: []
      })
    ).toBeUndefined()
  })

  it('un plafond dur à zéro arrête immédiatement, en le disant', () => {
    const motif = arretDeLaReparation({
      tentative: 0,
      reparationsAccordees: 0,
      plafondDur: 0,
      motifsCourants: refusB,
      motifsPrecedents: []
    })
    expect(motif).toContain('plafond')
  })
})
