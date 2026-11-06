import { describe, expect, it } from 'vitest'
import { deciderDuPassage, type EtatDeBoucleDeReparation } from './boucle-reparation'
import { evaluateClosure } from '../gates/stopgate'

/**
 * 2026-11-05 : 202 passages build Opus, 364 $, le MÊME refus du contrôle final à chaque
 * passage, en mode « jusqu'au vert » (le mode de production). Choix utilisateur :
 * « le même refus revenu 3 fois de suite arrête la boucle, même en mode jusqu'au vert ».
 *
 * Ce test rejoue la BOUCLE telle que l'orchestrateur la mène (`orchestrator-parcours-sequentiel.ts` :
 * `deciderDuPassage` appelé après chaque refus, l'état reporté d'un passage au suivant), pas la seule
 * règle d'arrêt : le compteur que la boucle transmet est compté avant le refus courant, et un test
 * qui fournirait ce compteur à la main passerait à côté du décalage.
 *
 * Le refus est produit par `evaluateClosure` comme en production. Chemins neutralisés (garde de
 * séparation entreprise) : seuls comptent le motif et sa répétition.
 */
const CIBLE_NOMMEE_CONV_1618 =
  'Cible nommee dans la demande reellement modifiee : projet/src/infra/verrouillage/ombreverrou.cs, projet/src/application/commandes/traitercommandeservice.cs'

const REFUS_CONV_1618 = evaluateClosure({
  status: 'red',
  dod: [{ label: CIBLE_NOMMEE_CONV_1618, hasContent: true, checked: false }]
}).reasons

/** Joue la boucle jusqu'à l'arrêt : combien de refus le run a-t-il payés, et pourquoi s'arrête-t-il ? */
function jouerLaBoucle(refusDuPassage: (attempt: number) => readonly string[], max = 60) {
  let etat: EtatDeBoucleDeReparation = { motifsPrecedents: [], refusIdentiquesConsecutifs: 0 }
  for (let attempt = 0; attempt < max; attempt++) {
    const passage = deciderDuPassage({
      attempt,
      reparationsAccordees: 2,
      plafondDur: 24,
      motifsCourants: refusDuPassage(attempt),
      etat,
      jusquAuVert: true
    })
    if (passage.arret) return { refusPayes: attempt + 1, arret: passage.arret }
    etat = passage.etatSuivant
  }
  return { refusPayes: max, arret: undefined }
}

describe('jusqu au vert : le même refus 3 fois de suite arrête la boucle (conv-1618)', () => {
  it('le refus de conv-1618 est bien un refus mixte : échec relayé + promesse non tenue', () => {
    expect(REFUS_CONV_1618).toHaveLength(2)
    expect(REFUS_CONV_1618[1]).toContain(CIBLE_NOMMEE_CONV_1618)
  })

  it('le 3e refus identique d affilée arrête la boucle, et le motif le dit', () => {
    const { refusPayes, arret } = jouerLaBoucle(() => REFUS_CONV_1618)
    expect(refusPayes).toBe(3)
    expect(arret).toMatch(/même refus est revenu 3 fois de suite/)
  })

  it('jumeau : un refus qui CHANGE à chaque passage continue (le progrès reste sans plafond)', () => {
    // Le texte cité entre « » est neutralisé par `memeRefus` (reformulé d'un passage à l'autre) :
    // le changement doit porter HORS citation pour être un vrai changement de refus.
    const { refusPayes, arret } = jouerLaBoucle(
      (attempt) => [
        `Vérification en échec : la commande de contrôle a rendu le code ${attempt + 1} (0 = réussi).`
      ],
      40
    )
    expect(arret).toBeUndefined()
    expect(refusPayes).toBe(40)
  })

  it('jumeau : deux refus identiques puis un autre remettent le compte à un', () => {
    const autre = [
      'Vérification en échec : la commande de contrôle a rendu le code 1 (0 = réussi).'
    ]
    const suite = [REFUS_CONV_1618, REFUS_CONV_1618, autre, REFUS_CONV_1618, REFUS_CONV_1618]
    const { refusPayes, arret } = jouerLaBoucle((attempt) => suite[attempt] ?? REFUS_CONV_1618)
    // Le 3e refus identique D'AFFILÉE n'arrive qu'au 6e passage.
    expect(refusPayes).toBe(6)
    expect(arret).toMatch(/3 fois de suite/)
  })
})
