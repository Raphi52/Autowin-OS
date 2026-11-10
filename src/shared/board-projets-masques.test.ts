import { describe, expect, it } from 'vitest'
import type { CarteDesBesoins, ProjetDeLaCarte, StatutDemande } from './carte-des-besoins'
import {
  basculerProjetMasque,
  carteSansProjetsMasques,
  ecrireProjetsMasques,
  lireProjetsMasques,
  projetMasque,
  projetsMasquesLisibles
} from './board-projets-masques'

/**
 * Les projets masqués SUR CE POSTE : un réglage de l'écran, jamais de la copie partagée. ENTRÉES QUI
 * DOIVENT FAIRE ÉCHOUER CE FICHIER : une carte d'origine modifiée par le masque (le partage la lit
 * aussi) ; un projet masqué qui reste affiché parce que sa casse ou son séparateur de chemin diffère ;
 * un réglage du poste illisible qui fait planter l'écran au lieu de rendre « rien de masqué ».
 */

const comptes = (
  partiel: Partial<Record<StatutDemande, number>> = {}
): Record<StatutDemande, number> => ({
  prouve: 0,
  refuse: 0,
  'en-cours': 0,
  'sans-preuve': 0,
  ...partiel
})

function projet(
  cle: string,
  n: number,
  c: Partial<Record<StatutDemande, number>>
): ProjetDeLaCarte {
  return {
    cle,
    libelle: cle,
    nature: 'dossier',
    conversations: 1,
    demandes: Array.from({ length: n }, (_, rang) => ({
      conversationId: `conv-${cle}`,
      conversationTitre: cle,
      rang,
      titre: `d${rang}`,
      statut: 'prouve' as const,
      constat: ''
    })),
    runsBloques: cle === 'P2' ? [{ sujet: 's', statut: 'red', chemin: 'c', mtime: 1 }] : [],
    comptes: comptes(c)
  }
}

const CARTE: CarteDesBesoins = {
  projets: [projet('P1', 3, { prouve: 2, refuse: 1 }), projet('P2', 2, { prouve: 2 })],
  comptes: comptes({ prouve: 4, refuse: 1 }),
  demandes: 5,
  runsBloques: 1,
  conversationsLues: 2,
  demandeurs: [],
  demandesJournalisees: 0,
  calculeeA: 1,
  dureeMs: 1
}

/** Un stockage du poste en mémoire, comme `window.localStorage` pour les deux méthodes utilisées. */
function stockage(): {
  getItem: (c: string) => string | null
  setItem: (c: string, v: string) => void
} {
  const valeurs = new Map<string, string>()
  return {
    getItem: (c) => valeurs.get(c) ?? null,
    setItem: (c, v) => {
      valeurs.set(c, v)
    }
  }
}

describe('projetsMasquesLisibles — le réglage relu du poste', () => {
  it('garde les noms, sans vide ni doublon, et refuse le reste sans rien casser', () => {
    expect(projetsMasquesLisibles(['D:\\Perso', ' D:\\Perso ', '', 3, 'P1'])).toEqual([
      'D:\\Perso',
      'P1'
    ])
    expect(projetsMasquesLisibles('P1')).toEqual([])
    expect(projetsMasquesLisibles(null)).toEqual([])
  })
})

describe('projetMasque et basculerProjetMasque — la casse du dossier ne compte pas', () => {
  it('reconnaît le même dossier écrit autrement, et cocher puis décocher revient au début', () => {
    expect(projetMasque(['D:\\Perso'], 'd:\\perso')).toBe(true)
    expect(projetMasque([], 'D:\\Perso')).toBe(false)
    const masques = basculerProjetMasque([], 'D:\\Perso')
    expect(masques).toEqual(['D:\\Perso'])
    expect(basculerProjetMasque(masques, 'd:\\perso')).toEqual([])
  })

  it('ne modifie pas la liste reçue', () => {
    const recue = ['P1']
    basculerProjetMasque(recue, 'P2')
    expect(recue).toEqual(['P1'])
  })
})

describe('carteSansProjetsMasques — ce que l’écran montre, sans toucher à la carte d’origine', () => {
  it('sans masque, rend la carte telle quelle', () => {
    expect(carteSansProjetsMasques(CARTE, [])).toBe(CARTE)
  })

  it('retire le projet masqué et refait ses comptes, sans modifier la carte reçue', () => {
    const avant = JSON.stringify(CARTE)
    const affichee = carteSansProjetsMasques(CARTE, ['P2'])
    expect(affichee.projets.map((p) => p.cle)).toEqual(['P1'])
    expect(affichee.demandes).toBe(3)
    expect(affichee.runsBloques).toBe(0)
    expect(affichee.comptes).toEqual(comptes({ prouve: 2, refuse: 1 }))
    expect(JSON.stringify(CARTE)).toBe(avant)
  })

  it('masque un projet écrit avec une autre casse que la carte', () => {
    const affichee = carteSansProjetsMasques(CARTE, ['p2'])
    expect(affichee.projets.map((p) => p.cle)).toEqual(['P1'])
  })
})

describe('lireProjetsMasques / ecrireProjetsMasques — le réglage reste sur ce poste', () => {
  it('relit ce qui a été écrit, rend rien si rien n’est écrit, et rien si le texte est illisible', () => {
    const poste = stockage()
    expect(lireProjetsMasques(poste)).toEqual([])
    expect(ecrireProjetsMasques(['P1'], poste)).toBeNull()
    expect(lireProjetsMasques(poste)).toEqual(['P1'])
    poste.setItem('autowin.board.projetsMasques', '{pas du json')
    expect(lireProjetsMasques(poste)).toEqual([])
  })

  it('un stockage plein rend l’erreur au lieu de la lever', () => {
    const plein = {
      getItem: (): string | null => null,
      setItem: (): void => {
        throw new Error('stockage plein')
      }
    }
    expect(ecrireProjetsMasques(['P1'], plein)).toBeInstanceOf(Error)
  })
})
