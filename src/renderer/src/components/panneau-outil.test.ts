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
  nouveautesDans,
  OUTILS_AU_REPOS,
  ouvrirDans,
  placeDuPanneau,
  poserLesPanneaux,
  signalerDans
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

/*
 * « Quand un bureau caché se lance, au lieu de m'ouvrir le panel, ça doit me mettre un petit 1 rouge
 * sous l'icône ; pareil pour les navigateurs ouverts » (2026-11-19).
 */
describe('chiffre rouge des icônes', () => {
  it('un lancement compte sans ouvrir de panneau, et chaque fil a le sien', () => {
    const un = signalerDans(OUTILS_AU_REPOS, 'A', 'bureaux')
    expect(un.panneaux).toBe(AUCUN_PANNEAU)
    expect(nouveautesDans(un, 'A', 'bureaux')).toBe(1)
    const trois = signalerDans(signalerDans(un, 'A', 'bureaux'), 'A', 'navigateur', 2)
    expect(nouveautesDans(trois, 'A', 'bureaux')).toBe(2)
    expect(nouveautesDans(trois, 'A', 'navigateur')).toBe(2)
    expect(nouveautesDans(trois, 'B', 'bureaux')).toBe(0)
    expect(nouveautesDans(trois, null, 'navigateur')).toBe(0)
  })

  it('panneau déjà ouvert sur cet outil : la nouveauté s’y voit, rien à compter', () => {
    const ouvert = poserLesPanneaux(OUTILS_AU_REPOS, ouvrirDans(AUCUN_PANNEAU, 'A', 'bureaux'))
    expect(signalerDans(ouvert, 'A', 'bureaux')).toBe(ouvert)
    // L'autre outil du même fil, lui, compte : son panneau n'est pas à l'écran.
    expect(nouveautesDans(signalerDans(ouvert, 'A', 'navigateur'), 'A', 'navigateur')).toBe(1)
  })

  it('ouvrir le panneau remet son chiffre à zéro, pas celui de l’autre outil ni d’un autre fil', () => {
    let outils = signalerDans(OUTILS_AU_REPOS, 'A', 'bureaux', 2)
    outils = signalerDans(outils, 'A', 'navigateur')
    outils = signalerDans(outils, 'B', 'bureaux')
    outils = poserLesPanneaux(outils, basculerBureauxDans(outils.panneaux, 'A'))
    expect(nouveautesDans(outils, 'A', 'bureaux')).toBe(0)
    expect(nouveautesDans(outils, 'A', 'navigateur')).toBe(1)
    expect(nouveautesDans(outils, 'B', 'bureaux')).toBe(1)
    // Refermé, il ne ressort pas l'ancien chiffre.
    outils = poserLesPanneaux(outils, fermerDans(outils.panneaux, 'A'))
    expect(nouveautesDans(outils, 'A', 'bureaux')).toBe(0)
  })

  it('rien ne change → le même objet', () => {
    expect(signalerDans(OUTILS_AU_REPOS, 'A', 'bureaux', 0)).toBe(OUTILS_AU_REPOS)
    expect(poserLesPanneaux(OUTILS_AU_REPOS, OUTILS_AU_REPOS.panneaux)).toBe(OUTILS_AU_REPOS)
    const ouvertSansChiffre = ouvrirDans(AUCUN_PANNEAU, 'A', 'navigateur')
    expect(poserLesPanneaux(OUTILS_AU_REPOS, ouvertSansChiffre).nouveautes).toBe(
      OUTILS_AU_REPOS.nouveautes
    )
  })
})
