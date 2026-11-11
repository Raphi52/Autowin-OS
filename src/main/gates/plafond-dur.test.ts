import { describe, expect, it } from 'vitest'
import { arretDeLaReparation, plafondDurReparations } from './stopgate'

/**
 * UNE SEULE SOURCE pour le plafond dur — la leçon la plus chère de ce chantier.
 *
 * Le défaut d'origine était exactement celui-là : deux mécaniques lisaient le MÊME budget de retour
 * sans le savoir (le marcheur de graphe et la boucle de réparation), si bien qu'un run tout-rouge
 * faisait 5 à 7 passages `build` là où le profil en annonçait 2 ou 3 — et que le devis
 * sous-provisionnait d'autant.
 *
 * En relevant le plafond pour laisser un run PROGRESSER au-delà des réparations provisionnées, on
 * recrée ce défaut si le devis continue de provisionner l'ancien chiffre. D'où cette fonction : la
 * boucle et le devis lisent la même, et un test le vérifie plutôt que de faire confiance.
 */
/*
 * Un plafond à zéro arrête le run : l'arrêt doit DIRE pourquoi. Le motif de la politique (budget bloquant,
 * plafond déclaré à zéro) était déjà poussé dans la trace ; le message d'arrêt, lui, restait muet.
 */
describe('plafond dur à zéro : l’arrêt dit pourquoi', () => {
  it('cite le motif de la politique dans le message d’arrêt, jamais un arrêt muet', () => {
    const arret = arretDeLaReparation({
      tentative: 1,
      reparationsAccordees: 0,
      plafondDur: 0,
      motifPlafond:
        'aucune réparation : le budget est en mode bloquant, une nouvelle dépense demande un nouveau tour humain',
      motifsCourants: ['Promis mais pas fait : 1 point(s) annoncé(s) au départ ne sont pas faits.'],
      motifsPrecedents: []
    })
    expect(arret).toContain('plafond dur de 0 passage(s) atteint')
    expect(arret).toContain('le budget est en mode bloquant')
  })
})

describe('plafond dur des réparations', () => {
  it('laisse de la marge au-delà des réparations provisionnées', () => {
    // C'est tout l'objet : un run qui progresse doit pouvoir dépasser le provisionnement.
    expect(plafondDurReparations(2)).toBeGreaterThan(2)
    expect(plafondDurReparations(3)).toBeGreaterThan(3)
  })

  it('rien accordé ⇒ rien de permis : le plafond n’ACCORDE pas', () => {
    /**
     * Ce test exigeait un plafond STRICTEMENT POSITIF même sans réparation accordée. Neuf tests
     * existants ont refusé ce design, à raison : il accordait deux passages là où la politique en
     * refusait zéro, contournant le régime jetable, un graphe sans arête rouge, et la règle « aucune
     * reprise automatique sous budget bloquant ». Un plafond BORNE, il n'autorise pas.
     */
    expect(plafondDurReparations(0)).toBe(0)
  })

  it('reste FINI dès qu’il permet quelque chose', () => {
    // Le budget ne bloque pas par défaut : sans plafond fini, plus rien n'arrêterait un run qui
    // reformule indéfiniment son refus.
    for (const n of [1, 2, 5]) expect(Number.isFinite(plafondDurReparations(n))).toBe(true)
  })

  it('est monotone : plus de réparations accordées, jamais moins de plafond', () => {
    let precedent = plafondDurReparations(0)
    for (const n of [1, 2, 3, 5, 8]) {
      const courant = plafondDurReparations(n)
      expect(courant).toBeGreaterThanOrEqual(precedent)
      precedent = courant
    }
  })

  it('ne rend jamais un nombre négatif ni fractionnaire', () => {
    expect(plafondDurReparations(-4)).toBeGreaterThanOrEqual(0)
    expect(Number.isInteger(plafondDurReparations(2.5))).toBe(true)
  })
})
