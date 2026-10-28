import { describe, expect, it } from 'vitest'
import type { CarteDesBesoins, ProjetDeLaCarte, StatutDemande } from './carte-des-besoins'
import {
  basculerProjetPartage,
  carteDesProjetsPartages,
  PROJETS_PARTAGES_MAX,
  projetPartage,
  projetsPartagesLisibles,
  resumeDesProjetsPartages
} from './board-projets-partages'

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
    runsBloques: cle === 'D:\\Perso' ? [{ sujet: 's', statut: 'red', chemin: 'c', mtime: 1 }] : [],
    comptes: comptes(c)
  }
}

const CARTE: CarteDesBesoins = {
  projets: [
    projet('D:\\Factures', 3, { prouve: 2, refuse: 1 }),
    projet('D:\\Perso', 2, { prouve: 2 })
  ],
  comptes: comptes({ prouve: 4, refuse: 1 }),
  demandes: 5,
  runsBloques: 1,
  conversationsLues: 2,
  demandeurs: [],
  demandesJournalisees: 0,
  calculeeA: 1,
  dureeMs: 1
}

describe('projetsPartagesLisibles — le choix reçu de la vue ou relu du poste', () => {
  it('absent = tous ; liste nettoyée ; forme inattendue refusée', () => {
    expect(projetsPartagesLisibles(undefined)).toBeNull()
    expect(projetsPartagesLisibles(null)).toBeNull()
    expect(projetsPartagesLisibles([' D:\\A ', 'D:\\A', '', 'B'])).toEqual(['D:\\A', 'B'])
    expect(projetsPartagesLisibles([])).toEqual([])
    expect(projetsPartagesLisibles('D:\\A')).toBeUndefined()
    expect(projetsPartagesLisibles([1])).toBeUndefined()
    expect(projetsPartagesLisibles(Array(PROJETS_PARTAGES_MAX + 1).fill('x'))).toBeUndefined()
  })
})

describe('carteDesProjetsPartages — ce qui part sur le partage', () => {
  it('null = la carte telle quelle', () => {
    expect(carteDesProjetsPartages(CARTE, null)).toBe(CARTE)
  })

  it('ne garde que les projets cochés et refait les comptes', () => {
    const reduite = carteDesProjetsPartages(CARTE, ['D:\\Factures'])
    expect(reduite.projets.map((p) => p.cle)).toEqual(['D:\\Factures'])
    expect(reduite.demandes).toBe(3)
    expect(reduite.comptes).toEqual(comptes({ prouve: 2, refuse: 1 }))
    expect(reduite.runsBloques).toBe(0)
  })

  it('aucun projet coché = un Board vide, pas tout le Board', () => {
    const vide = carteDesProjetsPartages(CARTE, [])
    expect(vide.projets).toEqual([])
    expect(vide.demandes).toBe(0)
  })
})

describe('basculer et résumer le choix', () => {
  const affiches = ['D:\\Factures', 'D:\\Perso']

  it('décocher depuis « tous » rend la liste explicite des autres projets affichés', () => {
    expect(basculerProjetPartage(null, 'D:\\Perso', affiches)).toEqual(['D:\\Factures'])
    expect(basculerProjetPartage(['D:\\Factures'], 'D:\\Perso', affiches)).toEqual([
      'D:\\Factures',
      'D:\\Perso'
    ])
  })

  it('un projet coché mais absent de la carte reste dans le choix', () => {
    expect(basculerProjetPartage(['D:\\Ancien'], 'D:\\Factures', affiches)).toEqual([
      'D:\\Ancien',
      'D:\\Factures'
    ])
  })

  it('résumé : tous, ou n sur les projets affichés', () => {
    expect(resumeDesProjetsPartages(null, affiches)).toEqual({ tous: true })
    expect(resumeDesProjetsPartages(['D:\\Factures', 'D:\\Ancien'], affiches)).toEqual({
      tous: false,
      partages: 1,
      total: 2
    })
    expect(projetPartage(null, 'x')).toBe(true)
    expect(projetPartage(['a'], 'x')).toBe(false)
  })
})
