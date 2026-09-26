import { describe, expect, it } from 'vitest'
import { CLOSURE_UPSTREAM_REFUSAL, arretDeLaReparation, memeRefus } from './stopgate'

/**
 * UNE PROMESSE NON TENUE QUI CHANGE DE FORMULATION RESTE LE MÊME REFUS.
 *
 * Défaut MESURÉ le 2026-09-17 sur `activity/*.jsonl` : depuis le 13/09, 336 contrôles de clôture,
 * dont 111 refus « Promis mais pas fait » et 83 « Échec déjà déclaré ». Conséquence directe : la
 * durée médiane d'une tâche est passée de 2,5-6,8 min (02→09/09, 6-7 étapes) à 14,5-26,5 min
 * (13→17/09, 15-18 étapes), alors qu'un appel de modèle pris isolément n'a PAS ralenti (81 s
 * aujourd'hui contre 106 s le 02/09). Ce sont des tours de boucle en plus, pas un modèle plus lent.
 *
 * La cause : `evaluateClosure` écrit ce motif de DEUX façons selon que les libellés sont
 * disponibles — « Promis mais pas fait : « X », « Y ». » ou « Promis mais pas fait : 1 point(s)
 * annoncé(s) au départ ne sont pas faits. ». D'un passage de réparation à l'autre, la forme
 * oscille ; `memeRefus` comparait donc deux textes différents et le refus figé n'était jamais
 * reconnu. Sur 188 paires de refus consécutifs relevées, 88 seulement étaient reconnues.
 */
describe('réparation — promesse non tenue reformulée entre deux passages', () => {
  const avecLibelles = [
    CLOSURE_UPSTREAM_REFUSAL,
    'Promis mais pas fait : « Cible nommee reellement modifiee », « Tests executes ».'
  ]
  const avecCompte = [
    CLOSURE_UPSTREAM_REFUSAL,
    'Promis mais pas fait : 1 point(s) annoncé(s) au départ ne sont pas faits.'
  ]

  it('reconnaît le MÊME refus malgré le changement de formulation', () => {
    expect(memeRefus(avecCompte, avecLibelles)).toBe(true)
    expect(memeRefus(avecLibelles, avecCompte)).toBe(true)
  })

  it('coupe la boucle quand ce refus revient une deuxième fois de suite', () => {
    const motif = arretDeLaReparation({
      tentative: 2,
      reparationsAccordees: 2,
      plafondDur: 24,
      motifsCourants: avecCompte,
      motifsPrecedents: avecLibelles,
      refusIdentiquesConsecutifs: 2
    })
    expect(motif).toBeTruthy()
  })

  it('ne confond pas deux refus de NATURE différente', () => {
    expect(
      memeRefus(avecCompte, [CLOSURE_UPSTREAM_REFUSAL, 'Signal rouge : code de sortie 1 != 0.'])
    ).toBe(false)
  })
})
