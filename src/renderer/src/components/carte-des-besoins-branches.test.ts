import { describe, expect, it } from 'vitest'
import {
  brancheDuFil,
  branchesDe,
  classerConstat,
  filsDuProjet,
  MAX_SEMAINES
} from './carte-des-besoins-branches'
import type { DemandeDeLaCarte, StatutDemande } from '../../../shared/carte-des-besoins'

/**
 * LA FICHE DE LA CARTE DES BESOINS (/draft conv-1102, 2026-10-22). ENTRÉES QUI DOIVENT FAIRE ÉCHOUER :
 * un fil compté refusé alors qu'une de ses demandes est prouvée, un fil rangé par sa PREMIÈRE
 * demande au lieu de la dernière, une semaine sans activité qui disparaît du peigne (le trou
 * compte), un historique de six mois qui étire le peigne sans fin, un run réussi pris pour un test.
 */

const jour = (mois: number, quantieme: number, heure = 12): number =>
  new Date(2026, mois - 1, quantieme, heure).getTime()

const demande = (
  conversationId: string,
  rang: number,
  statut: StatutDemande,
  debut: number | undefined,
  constat = statut === 'prouve' ? 'npm test → exit 0' : 'fini sans vérification'
): DemandeDeLaCarte => ({
  conversationId,
  conversationTitre: `Fil ${conversationId}`,
  rang,
  titre: `demande ${conversationId}-${rang}`,
  statut,
  constat,
  ...(debut === undefined ? {} : { debut })
})

describe('filsDuProjet', () => {
  it('regroupe par fil, garde l’ordre du fil, et date le fil par sa dernière activité', () => {
    const fils = filsDuProjet([
      demande('a', 4, 'sans-preuve', jour(10, 20)),
      demande('b', 0, 'refuse', jour(10, 21)),
      demande('a', 0, 'prouve', jour(10, 1)),
      demande('a', 2, 'refuse', jour(10, 10))
    ])
    expect(fils.map((f) => f.conversationId)).toEqual(['b', 'a'])
    const a = fils[1]
    expect(a.demandes.map((d) => d.rang)).toEqual([0, 2, 4])
    expect(a.derniere.rang).toBe(4)
    expect(a.derniereActivite).toBe(jour(10, 20))
    expect(a.comptes).toEqual({ prouve: 1, refuse: 1, 'en-cours': 0, 'sans-preuve': 1 })
  })

  it('un fil est prouvé dès qu’une demande l’est, sinon refusé, sinon en cours, sinon sans preuve', () => {
    const etats = filsDuProjet([
      demande('p', 0, 'refuse', jour(10, 5)),
      demande('p', 1, 'prouve', jour(10, 5)),
      demande('r', 0, 'refuse', jour(10, 4)),
      demande('r', 1, 'en-cours', jour(10, 4)),
      demande('c', 0, 'sans-preuve', jour(10, 3)),
      demande('c', 1, 'en-cours', jour(10, 3)),
      demande('s', 0, 'sans-preuve', jour(10, 2))
    ]).map((f) => [f.conversationId, f.etat])
    expect(etats).toEqual([
      ['p', 'prouve'],
      ['r', 'refuse'],
      ['c', 'en-cours'],
      ['s', 'sans-preuve']
    ])
  })
})

describe('classerConstat', () => {
  it.each([
    ['prouve', 'npm run typecheck → exit 0', 'typecheck'],
    ['prouve', 'npx vitest run src/x.test.ts → exit 0', 'tests'],
    ['prouve', 'npm test → exit 0', 'tests'],
    ['prouve', 'npm run lint → exit 0', 'autre-preuve'],
    ['prouve', 'succeeded', 'run'],
    ['prouve', 'terminé', 'run'],
    ['refuse', 'npm test → exit 1', 'arret'],
    ['refuse', 'tour arrêté avant la fin', 'arret'],
    ['refuse', 'tour en échec : quota', 'arret'],
    ['refuse', '⛔ Bloqué : il manque le secret', 'bloque'],
    ['refuse', '⚠️ Non résolu — hors périmètre', 'bloque'],
    ['sans-preuve', 'fini sans vérification', 'sans-verification'],
    ['sans-preuve', 'une question t’attend', 'attente'],
    ['en-cours', 'l’agent travaille', 'attente']
  ] as const)('%s « %s » → %s', (statut, constat, famille) => {
    expect(classerConstat({ statut, constat })).toBe(famille)
  })
})

describe('branchesDe', () => {
  it('semaine : un peigne continu, semaines vides comprises, la plus récente en dernier', () => {
    const fils = filsDuProjet([
      demande('a', 0, 'prouve', jour(9, 29)), // semaine du 28/09
      demande('b', 0, 'refuse', jour(10, 14)), // semaine du 12/10
      demande('c', 0, 'sans-preuve', jour(10, 15)) // semaine du 12/10
    ])
    const branches = branchesDe(fils, 'semaine')
    expect(branches.map((b) => [b.libelle, b.fils.length])).toEqual([
      ['28/09', 1],
      ['05/10', 0],
      ['12/10', 2]
    ])
    expect(branches[2].comptes).toEqual({ prouve: 0, refuse: 1, 'en-cours': 0, 'sans-preuve': 1 })
    expect(brancheDuFil(branches, 'a')).toBe(branches[0].cle)
  })

  it('semaine : au-delà de MAX_SEMAINES, les plus anciennes se regroupent ; un fil sans date a sa dent', () => {
    const vieux = Array.from({ length: MAX_SEMAINES + 3 }, (_, i) =>
      demande(`f${i}`, 0, 'sans-preuve', jour(7, 6) + i * 7 * 86_400_000)
    )
    const branches = branchesDe(
      filsDuProjet([...vieux, demande('x', 0, 'prouve', undefined)]),
      'semaine'
    )
    expect(branches).toHaveLength(MAX_SEMAINES + 2)
    expect(branches[0].cle).toBe('avant')
    expect(branches[0].fils).toHaveLength(3)
    expect(branches.at(-1)).toMatchObject({ cle: 'sans-date', libelle: 'sans date' })
    expect(branches.at(-1)!.fils.map((f) => f.conversationId)).toEqual(['x'])
  })

  it('état : une branche par état présent, dans l’ordre prouvé, refusé, en cours, sans preuve', () => {
    const branches = branchesDe(
      filsDuProjet([
        demande('a', 0, 'sans-preuve', jour(10, 1)),
        demande('b', 0, 'prouve', jour(10, 2)),
        demande('c', 0, 'sans-preuve', jour(10, 3))
      ]),
      'etat'
    )
    expect(branches.map((b) => [b.cle, b.libelle, b.fils.length])).toEqual([
      ['prouve', 'prouvé', 1],
      ['sans-preuve', 'sans preuve', 2]
    ])
  })

  it('dernier constat : le fil est rangé par sa DERNIÈRE demande', () => {
    const branches = branchesDe(
      filsDuProjet([
        demande('a', 0, 'prouve', jour(10, 1), 'npm run typecheck → exit 0'),
        demande('a', 1, 'sans-preuve', jour(10, 2)),
        demande('b', 0, 'prouve', jour(10, 3), 'npm run typecheck → exit 0')
      ]),
      'constat'
    )
    expect(branches.map((b) => [b.cle, b.fils.map((f) => f.conversationId)])).toEqual([
      ['sans-verification', ['a']],
      ['typecheck', ['b']]
    ])
  })
})
