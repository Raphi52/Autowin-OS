import { describe, expect, it } from 'vitest'
import {
  AUCUN_PANNEAU,
  PLACE_FIL_NEUF,
  PLACE_MOSAIQUE,
  adopterLeFilNeuf,
  basculerBureauxDans,
  basculerNavigateurDans,
  bureauxOuvertsDans,
  fermerDans,
  navigateurOuvertDans,
  ouvrirDans,
  placeDuPanneau
} from './panneau-outil'

describe('panneau d’outil du chat', () => {
  it('le navigateur ne s’affiche que dans le fil qui l’a ouvert', () => {
    const panneaux = ouvrirDans(AUCUN_PANNEAU, 'A', 'navigateur')
    expect(navigateurOuvertDans(panneaux, 'A')).toBe(true)
    expect(navigateurOuvertDans(panneaux, 'B')).toBe(false)
    // Fil neuf, pas encore créé : rien à montrer.
    expect(navigateurOuvertDans(panneaux, null)).toBe(false)
  })

  it('le globe ouvre dans le fil courant, sans toucher au panneau d’un autre fil', () => {
    const dansA = basculerNavigateurDans(AUCUN_PANNEAU, 'A')
    expect(navigateurOuvertDans(dansA, 'A')).toBe(true)
    expect(basculerNavigateurDans(dansA, 'A')).toEqual(AUCUN_PANNEAU)
    const dansB = basculerNavigateurDans(dansA, 'B')
    expect(navigateurOuvertDans(dansB, 'A')).toBe(true)
    expect(navigateurOuvertDans(dansB, 'B')).toBe(true)
    // Dans un même fil, le navigateur prend la place des Bureaux cachés.
    const bureaux = ouvrirDans(AUCUN_PANNEAU, 'A', 'bureaux')
    expect(basculerNavigateurDans(bureaux, 'A')).toEqual({ A: 'navigateur' })
  })

  it('sans fil ouvert, le globe ne change rien', () => {
    const bureauxSurLeFilNeuf = ouvrirDans(AUCUN_PANNEAU, PLACE_FIL_NEUF, 'bureaux')
    expect(basculerNavigateurDans(AUCUN_PANNEAU, null)).toBe(AUCUN_PANNEAU)
    expect(basculerNavigateurDans(bureauxSurLeFilNeuf, null)).toBe(bureauxSurLeFilNeuf)
  })

  it('les Bureaux cachés ouverts dans A ne s’ouvrent pas dans B', () => {
    const dansA = basculerBureauxDans(AUCUN_PANNEAU, 'A')
    expect(bureauxOuvertsDans(dansA, 'A')).toBe(true)
    expect(bureauxOuvertsDans(dansA, 'B')).toBe(false)
    expect(navigateurOuvertDans(dansA, 'A')).toBe(false)
    // Fermer dans A ne touche pas au panneau de B.
    const dansLesDeux = basculerBureauxDans(dansA, 'B')
    expect(basculerBureauxDans(dansLesDeux, 'A')).toEqual({ B: 'bureaux' })
    // Ils prennent la place du navigateur du même fil.
    expect(basculerBureauxDans(ouvrirDans(AUCUN_PANNEAU, 'A', 'navigateur'), 'A')).toEqual({
      A: 'bureaux'
    })
  })

  it('la place suit la vue : mosaïque, fil affiché, ou fil neuf', () => {
    expect(placeDuPanneau('A', false)).toBe('A')
    expect(placeDuPanneau(null, false)).toBe(PLACE_FIL_NEUF)
    expect(placeDuPanneau('A', true)).toBe(PLACE_MOSAIQUE)
    expect(placeDuPanneau(null, true)).toBe(PLACE_MOSAIQUE)
  })

  it('le fil créé par le premier envoi reprend le panneau du fil neuf, qui se vide', () => {
    const neuf = ouvrirDans(ouvrirDans(AUCUN_PANNEAU, PLACE_FIL_NEUF, 'bureaux'), 'A', 'navigateur')
    expect(adopterLeFilNeuf(neuf, 'C')).toEqual({ A: 'navigateur', C: 'bureaux' })
    // Rien d'ouvert sur le fil neuf : rien ne change, pas même l'objet.
    const sansFilNeuf = ouvrirDans(AUCUN_PANNEAU, 'A', 'bureaux')
    expect(adopterLeFilNeuf(sansFilNeuf, 'C')).toBe(sansFilNeuf)
  })

  it('rien ne change → le même objet, pour ne rien redessiner', () => {
    const dansA = ouvrirDans(AUCUN_PANNEAU, 'A', 'bureaux')
    expect(ouvrirDans(dansA, 'A', 'bureaux')).toBe(dansA)
    expect(fermerDans(dansA, 'B')).toBe(dansA)
  })
})
