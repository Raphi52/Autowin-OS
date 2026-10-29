import { describe, expect, it, vi } from 'vitest'
import type { CarteDesBesoins, ProjetDeLaCarte } from '../../../shared/carte-des-besoins'
import {
  carteDuBoardAffichee,
  CLE_DOSSIERS_CONNUS,
  CLE_DOSSIERS_RETIRES,
  lignesDuMenuDesProjets,
  lireDossiersDuChat,
  retirerDossierDuChat
} from './dossiers-du-chat'

/**
 * La liste commune des dossiers du Chat, que la croix du Board retire (conv-1212). Entrée qui doit
 * faire échouer ce fichier : une croix du Board qui laisserait le dossier dans la liste du Chat, qui
 * oublierait de le mémoriser comme retiré (l'import claude.exe le ressusciterait), ou un menu qui
 * perdrait les dossiers du Chat sans demande.
 */
function stockage(initial: Record<string, string> = {}): Pick<Storage, 'getItem' | 'setItem'> & {
  valeurs: Record<string, string>
} {
  const valeurs = { ...initial }
  return {
    valeurs,
    getItem: (cle) => valeurs[cle] ?? null,
    setItem: (cle, valeur) => {
      valeurs[cle] = valeur
    }
  }
}

describe('lireDossiersDuChat', () => {
  it('seuls des chemins ; illisible = vide', () => {
    expect(
      lireDossiersDuChat(stockage({ [CLE_DOSSIERS_CONNUS]: '["D:\\\\A","Perso",3]' }))
    ).toEqual(['D:\\A'])
    expect(lireDossiersDuChat(stockage({ [CLE_DOSSIERS_CONNUS]: '{pas du json' }))).toEqual([])
  })
})

describe('retirerDossierDuChat — la croix du Board', () => {
  it('retire de la liste du Chat (même écrit autrement), mémorise le retrait, et l’annonce', () => {
    const s = stockage({
      [CLE_DOSSIERS_CONNUS]: JSON.stringify(['D:\\AutoWinOS', 'D:\\mesure-skills\\depot'])
    })
    const annoncer = vi.fn()
    const restants = retirerDossierDuChat('d:/mesure-skills/depot/', s, annoncer)
    expect(restants).toEqual(['D:\\AutoWinOS'])
    expect(JSON.parse(s.valeurs[CLE_DOSSIERS_CONNUS])).toEqual(['D:\\AutoWinOS'])
    expect(JSON.parse(s.valeurs[CLE_DOSSIERS_RETIRES])).toEqual(['D:\\mesure-skills\\depot'])
    expect(annoncer).toHaveBeenCalledTimes(1)
  })
})

describe('lignesDuMenuDesProjets', () => {
  it('chaque ligne a sa croix, même le dépôt par défaut hors liste ; puis les dossiers du Chat sans demande', () => {
    const lignes = lignesDuMenuDesProjets(
      [
        { cle: 'D:\\AutoWinOS', libelle: 'AutoWinOS', demandes: 12 },
        { cle: 'D:\\Factures', libelle: 'Factures', demandes: 2 }
      ],
      ['d:/factures', 'D:\\Neuf']
    )
    expect(lignes).toEqual([
      { cle: 'D:\\AutoWinOS', libelle: 'AutoWinOS', demandes: 12, retirable: 'D:\\AutoWinOS' },
      { cle: 'D:\\Factures', libelle: 'Factures', demandes: 2, retirable: 'd:/factures' },
      { cle: 'D:\\Neuf', libelle: 'Neuf', demandes: 0, retirable: 'D:\\Neuf' }
    ])
  })

  /**
   * conv-1231 : « j'ai perdu le this computer, il doit être impossible à supprimer ». Et son nom est
   * celui du Chat, pas le nom du dossier (conv-1230 : « c'est quoi cette ligne <compte Windows> ? »).
   */
  it('« This computer » n’a pas de croix et porte son nom du Chat, qu’il ait des demandes ou non', () => {
    const avecDemandes = lignesDuMenuDesProjets(
      [{ cle: 'C:\\Users\\Moi', libelle: 'Moi', demandes: 3 }],
      [],
      'c:/users/moi/'
    )
    expect(avecDemandes).toEqual([
      { cle: 'C:\\Users\\Moi', libelle: '💻 This computer', demandes: 3 }
    ])
    const sansDemande = lignesDuMenuDesProjets([], ['C:\\Users\\Moi', 'D:\\Neuf'], 'C:\\Users\\Moi')
    expect(sansDemande).toEqual([
      { cle: 'C:\\Users\\Moi', libelle: '💻 This computer', demandes: 0 },
      { cle: 'D:\\Neuf', libelle: 'Neuf', demandes: 0, retirable: 'D:\\Neuf' }
    ])
  })

  /** conv-1243 : « this computer met le en premier de la liste », quel que soit son rang d'activité. */
  it('« This computer » est la première ligne, avec ou sans demande', () => {
    const avecDemandes = lignesDuMenuDesProjets(
      [
        { cle: 'D:\\AutoWinOS', libelle: 'AutoWinOS', demandes: 12 },
        { cle: 'C:\\Users\\Moi', libelle: 'Moi', demandes: 1 },
        { cle: 'D:\\Factures', libelle: 'Factures', demandes: 2 }
      ],
      [],
      'C:\\Users\\Moi'
    )
    expect(avecDemandes.map((l) => l.libelle)).toEqual([
      '💻 This computer',
      'AutoWinOS',
      'Factures'
    ])
    const sansDemande = lignesDuMenuDesProjets(
      [{ cle: 'D:\\AutoWinOS', libelle: 'AutoWinOS', demandes: 12 }],
      ['D:\\Neuf', 'C:\\Users\\Moi'],
      'C:\\Users\\Moi'
    )
    expect(sansDemande.map((l) => l.libelle)).toEqual(['💻 This computer', 'AutoWinOS', 'Neuf'])
  })
})

describe('la croix sur un dossier que le Chat propose toujours (conv-1212, 2e demande)', () => {
  it('il n’est pas dans la liste du Chat : la croix le mémorise comme retiré, et il quitte le Board', () => {
    const s = stockage({ [CLE_DOSSIERS_CONNUS]: JSON.stringify(['D:\\Factures']) })
    expect(retirerDossierDuChat('D:\\AutoWinOS', s, () => {})).toEqual(['D:\\Factures'])
    expect(JSON.parse(s.valeurs[CLE_DOSSIERS_RETIRES])).toEqual(['D:\\AutoWinOS'])
    const carte = carteAvec(['D:\\AutoWinOS', 'D:\\Factures', 'D:\\mesure-skills\\depot'])
    const affichee = carteDuBoardAffichee(
      carte,
      lireDossiersDuChat(s),
      ['D:\\AutoWinOS', 'C:\\Users\\moi'],
      JSON.parse(s.valeurs[CLE_DOSSIERS_RETIRES]) as string[]
    )
    expect(affichee.projets.map((p) => p.cle)).toEqual(['D:\\Factures'])
  })

  it('« This computer » déjà mémorisé comme retiré reste au Board (conv-1231)', () => {
    const carte = carteAvec(['D:\\AutoWinOS', 'C:\\Users\\moi'])
    const affichee = carteDuBoardAffichee(
      carte,
      [],
      ['D:\\AutoWinOS', 'C:\\Users\\moi'],
      ['D:\\AutoWinOS', 'c:/users/moi/'],
      'C:\\Users\\moi'
    )
    expect(affichee.projets.map((p) => p.cle)).toEqual(['C:\\Users\\moi'])
  })

  it('la vue réduit elle-même ce que rend un processus principal d’avant redémarrage', () => {
    const carte = carteAvec(['D:\\AutoWinOS', 'D:\\mesure-skills\\depot'], true)
    const affichee = carteDuBoardAffichee(carte, [], ['D:\\AutoWinOS'], [])
    expect(affichee.projets.map((p) => p.cle)).toEqual(['D:\\AutoWinOS'])
  })

  it('dossiers toujours proposés illisibles = la carte reçue telle quelle (le dépôt ne disparaît pas)', () => {
    const carte = carteAvec(['D:\\AutoWinOS'])
    expect(carteDuBoardAffichee(carte, [], null, [])).toBe(carte)
  })
})

function carteAvec(cles: string[], avecDivers = false): CarteDesBesoins {
  const projets = cles.map((cle): ProjetDeLaCarte => ({
    cle,
    libelle: cle,
    nature: 'dossier',
    conversations: 1,
    demandes: [],
    runsBloques: [],
    comptes: { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 }
  }))
  if (avecDivers)
    projets.push({ ...projets[0], cle: 'divers', libelle: 'Divers', nature: 'divers' })
  return {
    projets,
    comptes: { prouve: 0, refuse: 0, 'en-cours': 0, 'sans-preuve': 0 },
    demandes: 0,
    runsBloques: 0,
    conversationsLues: 0,
    demandeurs: [],
    demandesJournalisees: 0,
    calculeeA: 1,
    dureeMs: 1
  }
}
