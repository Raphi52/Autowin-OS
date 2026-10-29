import { describe, expect, it } from 'vitest'
import type { CarteDesBesoins, DemandeDeLaCarte } from './carte-des-besoins'
import {
  carteAuNomDuPoste,
  cleDuPoste,
  NOM_DU_POSTE_MAX,
  nomDuPosteLisible
} from './board-nom-du-poste'

function demande(conversationId: string, rang: number, nomGit?: string): DemandeDeLaCarte {
  return {
    conversationId,
    conversationTitre: conversationId,
    rang,
    titre: `demande ${rang}`,
    statut: 'en-cours',
    constat: 'tour en cours',
    ...(nomGit
      ? {
          demandeur: {
            cle: `${nomGit.toLowerCase()}@ex.fr`,
            nom: nomGit,
            email: `${nomGit.toLowerCase()}@ex.fr`,
            origine: 'journal' as const
          }
        }
      : {})
  }
}

function carte(demandes: DemandeDeLaCarte[][]): CarteDesBesoins {
  return {
    projets: demandes.map((liste, i) => ({
      cle: `D:\\P${i}`,
      libelle: `P${i}`,
      nature: 'dossier' as const,
      conversations: liste.length,
      demandes: liste,
      runsBloques: [],
      comptes: { prouve: 0, refuse: 0, 'en-cours': liste.length, 'sans-preuve': 0 }
    })),
    comptes: { prouve: 0, refuse: 0, 'en-cours': 3, 'sans-preuve': 0 },
    demandes: 3,
    runsBloques: 0,
    conversationsLues: 3,
    demandeurs: [{ cle: 'surnom@ex.fr', nom: 'Surnom', email: 'surnom@ex.fr', demandes: 2 }],
    demandesJournalisees: 2,
    calculeeA: 1,
    dureeMs: 1
  }
}

describe('nomDuPosteLisible — le nom reçu de la vue ou du partage', () => {
  it('rend le nom nettoyé, null pour revenir au compte, undefined pour refuser', () => {
    expect(nomDuPosteLisible('  Élodie  Martin ')).toBe('Élodie Martin')
    expect(nomDuPosteLisible('a\nb')).toBe('a b')
    expect(nomDuPosteLisible(null)).toBeNull()
    expect(nomDuPosteLisible('   ')).toBeNull()
    expect(nomDuPosteLisible(12)).toBeUndefined()
    expect(nomDuPosteLisible({ nom: 'x' })).toBeUndefined()
    expect(nomDuPosteLisible('x'.repeat(NOM_DU_POSTE_MAX))).toHaveLength(NOM_DU_POSTE_MAX)
    expect(nomDuPosteLisible('x'.repeat(NOM_DU_POSTE_MAX + 1))).toBeUndefined()
  })
})

describe('carteAuNomDuPoste — une seule personne pour ce poste (conv-1230)', () => {
  it('pose le nom du poste sur toutes les demandes, identité git ou pas', () => {
    const avant = carte([
      [demande('conv-1', 0, 'Surnom'), demande('conv-2', 0)],
      [demande('conv-3', 0, 'Surnom')]
    ])
    const apres = carteAuNomDuPoste(avant, { compte: 'Prenom.Nom', nom: 'prenom.nom' })
    const demandeurs = apres.projets.flatMap((p) => p.demandes.map((d) => d.demandeur))
    expect(demandeurs).toEqual([
      { cle: 'poste:prenom.nom', nom: 'prenom.nom', origine: 'poste' },
      { cle: 'poste:prenom.nom', nom: 'prenom.nom', origine: 'poste' },
      { cle: 'poste:prenom.nom', nom: 'prenom.nom', origine: 'poste' }
    ])
    expect(apres.demandeurs).toEqual([{ cle: 'poste:prenom.nom', nom: 'prenom.nom', demandes: 3 }])
    // La carte reçue n'est pas modifiée : le calculateur la garde en cache.
    expect(avant.projets[0].demandes[0].demandeur?.nom).toBe('Surnom')
  })

  it('garde la clé du compte quand le nom choisi change', () => {
    const c = carte([[demande('conv-1', 0)]])
    const a = carteAuNomDuPoste(c, { compte: 'jdupont', nom: 'jdupont' })
    const b = carteAuNomDuPoste(c, { compte: 'jdupont', nom: 'Jean' })
    expect(a.demandeurs[0].cle).toBe(cleDuPoste('jdupont'))
    expect(b.demandeurs[0]).toEqual({ cle: 'poste:jdupont', nom: 'Jean', demandes: 1 })
  })

  it('une carte sans demande n’a personne', () => {
    expect(carteAuNomDuPoste(carte([[]]), { compte: 'moi', nom: 'moi' }).demandeurs).toEqual([])
  })
})
