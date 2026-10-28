import { describe, expect, it } from 'vitest'
import type { BoardDUnCollegue } from '../../../shared/board-collegues'
import type { CarteDesBesoins, StatutDemande } from '../../../shared/carte-des-besoins'
import { carteAvecCollegues, idDuFilDeCollegue } from './board-collegues'
import { riviereDe } from './carte-riviere'
import { postitsAVerifier } from './verification-du-board'

const comptes = (): Record<StatutDemande, number> => ({
  prouve: 0,
  refuse: 0,
  'en-cours': 0,
  'sans-preuve': 0
})

const MAINTENANT = new Date(2026, 9, 28, 12, 0).getTime()
const IL_Y_A = (h: number): number => MAINTENANT - h * 3_600_000

const CARTE: CarteDesBesoins = {
  projets: [
    {
      cle: 'D:\\AutoWinOS',
      libelle: 'AutoWinOS',
      nature: 'dossier',
      conversations: 1,
      demandes: [
        {
          conversationId: 'conv-1',
          conversationTitre: 'Mon fil',
          rang: 0,
          titre: 'ma demande',
          statut: 'prouve',
          constat: 'npm test → exit 0',
          debut: IL_Y_A(2),
          demandeur: { cle: 'moi@ex.fr', nom: 'Moi', email: 'moi@ex.fr', origine: 'journal' }
        }
      ],
      runsBloques: [],
      comptes: { ...comptes(), prouve: 1 }
    }
  ],
  comptes: { ...comptes(), prouve: 1 },
  demandes: 1,
  runsBloques: 0,
  conversationsLues: 1,
  demandeurs: [{ cle: 'moi@ex.fr', nom: 'Moi', email: 'moi@ex.fr', demandes: 1 }],
  demandesJournalisees: 1,
  calculeeA: MAINTENANT,
  dureeMs: 1
}

const JEAN: BoardDUnCollegue = {
  poste: 'jdupont',
  nom: 'Jean Dupont',
  postIts: [
    {
      // Même identifiant qu'un de nos fils : son conv-1 n'est pas le nôtre.
      conversationId: 'conv-1',
      titre: 'Le fil de Jean',
      projet: { cle: 'D:\\AutoWinOS', libelle: 'AutoWinOS' },
      // Posé à la main « À faire » sur SON Board, alors que ses preuves disent « Sans preuve ».
      etage: 'a-faire',
      etatPreuve: 'sans-preuve',
      derniereDemande: new Date(IL_Y_A(1)).toISOString(),
      demandes: [
        {
          rang: 0,
          titre: 'sa demande',
          statut: 'sans-preuve',
          constat: 'aucune vérification',
          date: new Date(IL_Y_A(1)).toISOString(),
          workItems: [{ sourceId: 'azdo', id: '1234' }]
        }
      ]
    },
    {
      conversationId: 'conv-7',
      titre: 'Autre fil de Jean',
      projet: { cle: 'D:\\Autre', libelle: 'Autre' },
      etage: 'sans-preuve',
      etatPreuve: 'sans-preuve',
      derniereDemande: new Date(IL_Y_A(3)).toISOString(),
      demandes: [
        {
          rang: 0,
          titre: 'à vérifier',
          statut: 'sans-preuve',
          constat: 'aucune vérification',
          date: new Date(IL_Y_A(3)).toISOString()
        }
      ]
    }
  ]
}

describe('carteAvecCollegues — les post-it des collègues mêlés à la carte AFFICHÉE', () => {
  it('sans collègue, rend la même carte (rien à recalculer)', () => {
    expect(carteAvecCollegues(CARTE, [])).toBe(CARTE)
    expect(carteAvecCollegues(CARTE, [{ ...JEAN, postIts: [] }])).toBe(CARTE)
  })

  it('préfixe les fils du poste du collègue et garde nos compteurs', () => {
    const carte = carteAvecCollegues(CARTE, [JEAN])
    const ids = carte.projets.flatMap((p) => p.demandes.map((d) => d.conversationId))
    expect(ids).toEqual(['conv-1', idDuFilDeCollegue('jdupont', 'conv-1'), 'jdupont/conv-7'])
    expect(carte.comptes).toEqual(CARTE.comptes)
    expect(carte.demandes).toBe(1)
    // La carte d'origine n'est pas touchée : c'est elle que le dossier du Board recopie.
    expect(CARTE.projets).toHaveLength(1)
  })

  it('donne au collègue une personne à son nom, pour la punaise et le filtre', () => {
    const carte = carteAvecCollegues(CARTE, [JEAN])
    expect(carte.demandeurs.map((d) => [d.nom, d.demandes])).toEqual([
      ['Moi', 1],
      ['Jean Dupont', 2]
    ])
  })
})

describe('riviereDe — un post-it de collègue est à son nom, à SON étage, et hors des gestes', () => {
  const riviere = riviereDe(carteAvecCollegues(CARTE, [JEAN]), MAINTENANT)
  const deJean = riviere.postits.find((p) => p.conversationId === 'jdupont/conv-1')

  it('porte le nom du collègue et son fil d’origine', () => {
    expect(deJean?.collegue?.nom).toBe('Jean Dupont')
    expect(deJean?.collegue?.conversationId).toBe('conv-1')
    expect(deJean?.demandeur?.nom).toBe('Jean Dupont')
  })

  it('est posé à l’étage de SON Board, état posé à la main compris', () => {
    expect(deJean?.etage).toBe('a-faire')
    expect(deJean?.etatPreuve).toBe('sans-preuve')
  })

  it('n’est jamais dans la ligne « À vérifier » : un /check ne part pas dans son fil', () => {
    const aVerifier = postitsAVerifier(riviere.postits, null).map((p) => p.conversationId)
    expect(aVerifier).not.toContain('jdupont/conv-7')
  })

  it('ignore nos états posés à la main, même pour un identifiant voisin', () => {
    const r = riviereDe(carteAvecCollegues(CARTE, [JEAN]), MAINTENANT, {
      'jdupont/conv-7': { etage: 'prouve', a: MAINTENANT }
    })
    expect(r.postits.find((p) => p.conversationId === 'jdupont/conv-7')?.etage).toBe('sans-preuve')
  })
})
