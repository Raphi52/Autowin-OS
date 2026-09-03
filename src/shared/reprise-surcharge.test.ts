import { describe, expect, it } from 'vitest'
import {
  MAX_REPRISES_SURCHARGE,
  deciderRepriseSurcharge,
  estSurchargeFournisseur,
  libelleRenoncement,
  libelleReprise
} from './reprise-surcharge'

describe('estSurchargeFournisseur', () => {
  it('reconnaît le message d’abandon de notre adaptateur Claude', () => {
    expect(
      estSurchargeFournisseur(
        'API Claude surchargée (529) — abandon après 10/10 tentatives, aucune réponse. Réessayez.'
      )
    ).toBe(true)
  })

  it('reconnaît le vocabulaire brut des fournisseurs', () => {
    expect(estSurchargeFournisseur('API Error: 529 {"type":"overloaded_error"}')).toBe(true)
    expect(estSurchargeFournisseur('HTTP 503 service_unavailable')).toBe(true)
    expect(estSurchargeFournisseur('Bad Gateway')).toBe(true)
    expect(estSurchargeFournisseur('fetch failed')).toBe(true)
    expect(estSurchargeFournisseur('ECONNRESET')).toBe(true)
    expect(estSurchargeFournisseur('erreur 529')).toBe(true)
  })

  it('ne prend PAS un nombre isolé pour une panne', () => {
    expect(estSurchargeFournisseur('ligne 529 du fichier')).toBe(false)
    expect(estSurchargeFournisseur('529')).toBe(false)
  })

  it('ne prend PAS un échec ordinaire pour une surcharge', () => {
    expect(estSurchargeFournisseur('Exit code: 1')).toBe(false)
    expect(estSurchargeFournisseur('2 tests en échec')).toBe(false)
    expect(estSurchargeFournisseur('')).toBe(false)
    expect(estSurchargeFournisseur(undefined)).toBe(false)
  })
})

describe('deciderRepriseSurcharge', () => {
  const echec529 = {
    ok: false,
    cancelled: false,
    erreur: 'API Claude surchargée (529) — abandon après 10/10 tentatives'
  }

  it('forke et reprend au premier échec de surcharge', () => {
    const decision = deciderRepriseSurcharge({ ...echec529, tentativesDejaFaites: 0 })
    expect(decision).toEqual({ action: 'forker-et-reprendre', tentative: 1, attenteMs: 30_000 })
  })

  it('fait croître l’attente d’une reprise à l’autre', () => {
    expect(deciderRepriseSurcharge({ ...echec529, tentativesDejaFaites: 1 })).toMatchObject({
      tentative: 2,
      attenteMs: 60_000
    })
    expect(deciderRepriseSurcharge({ ...echec529, tentativesDejaFaites: 2 })).toMatchObject({
      tentative: 3,
      attenteMs: 120_000
    })
  })

  it('renonce au plafond : la 4e reprise n’a pas lieu', () => {
    expect(
      deciderRepriseSurcharge({ ...echec529, tentativesDejaFaites: MAX_REPRISES_SURCHARGE })
    ).toEqual({ action: 'renoncer', raison: 'plafond-atteint' })
  })

  it('ne reprend jamais un tour réussi', () => {
    expect(
      deciderRepriseSurcharge({ ok: true, cancelled: false, tentativesDejaFaites: 0 })
    ).toEqual({ action: 'renoncer', raison: 'succes' })
  })

  it('ne reprend jamais un arrêt voulu par l’utilisateur, même libellé 529', () => {
    expect(
      deciderRepriseSurcharge({ ...echec529, cancelled: true, tentativesDejaFaites: 0 })
    ).toEqual({ action: 'renoncer', raison: 'annule' })
  })

  it('ne reprend pas un échec ordinaire', () => {
    expect(
      deciderRepriseSurcharge({
        ok: false,
        cancelled: false,
        erreur: 'Exit code: 1',
        tentativesDejaFaites: 0
      })
    ).toEqual({ action: 'renoncer', raison: 'pas-une-surcharge' })
  })

  it('respecte un plafond passé en entrée', () => {
    expect(deciderRepriseSurcharge({ ...echec529, tentativesDejaFaites: 1, max: 1 })).toEqual({
      action: 'renoncer',
      raison: 'plafond-atteint'
    })
  })
})

describe('libellés', () => {
  it('numérote la reprise et nomme la cause', () => {
    expect(libelleReprise(2)).toBe('Reprise 2/3 après surcharge du modèle.')
  })

  it('dit honnêtement le renoncement', () => {
    expect(libelleRenoncement()).toContain('3 reprises automatiques ont échoué')
  })
})

/**
 * SURCHARGE LIVRÉE COMME RÉPONSE (mesuré le 2026-09-03, conv-28) : le CLI n'a pas échoué, il a
 * « répondu » le texte de l'incident (« API Error: 529 Overloaded. This is a server-side issue… »).
 * Le tour comptait donc pour un SUCCÈS, aucune reprise ne partait, et l'utilisateur devait retaper
 * sa demande à la main. La décision doit voir le TEXTE RENDU, pas seulement le champ d'erreur.
 */
describe('surcharge rendue dans le texte de la réponse', () => {
  const texte529 =
    'API Error: 529 Overloaded. This is a server-side issue, usually temporary — try again in a moment.'

  it('un tour « réussi » dont toute la réponse est la surcharge se reprend', () => {
    expect(
      deciderRepriseSurcharge({
        ok: true,
        cancelled: false,
        texteRendu: texte529,
        tentativesDejaFaites: 0
      })
    ).toMatchObject({ action: 'forker-et-reprendre', tentative: 1 })
  })

  it('une vraie réponse qui PARLE de 529 ne se reprend pas', () => {
    const analyse =
      'La reprise auto ne regarde que le champ error du tour. ' +
      'Ici la surcharge (erreur 529) est arrivée dans le texte de la réponse, donc la porte a ' +
      "répondu « succès ». Je corrige la source pour que la décision voie aussi le texte rendu, " +
      'sans quoi tu dois retaper ta demande à la main à chaque incident du fournisseur.'
    expect(
      deciderRepriseSurcharge({
        ok: true,
        cancelled: false,
        texteRendu: analyse,
        tentativesDejaFaites: 0
      })
    ).toEqual({ action: 'renoncer', raison: 'succes' })
  })

  it('un arrêt voulu par l’utilisateur ne se reprend pas, même texte de surcharge', () => {
    expect(
      deciderRepriseSurcharge({
        ok: true,
        cancelled: true,
        texteRendu: texte529,
        tentativesDejaFaites: 0
      })
    ).toEqual({ action: 'renoncer', raison: 'annule' })
  })
})
