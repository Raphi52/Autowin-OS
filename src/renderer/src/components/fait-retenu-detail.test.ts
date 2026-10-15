import { describe, expect, it } from 'vitest'
import { lireFaitRetenu, lireReponseRemember } from './fait-retenu-detail'

describe('lireFaitRetenu — la réponse de remember, jamais ses arguments', () => {
  it('rend le fait validé, son titre et où il est parti', () => {
    expect(
      lireFaitRetenu(
        JSON.stringify({
          allowed: true,
          stored: false,
          unknown: true,
          detail: 'Brain injoignable : gardé dans ce fil',
          fact: { title: 'Titre', body: 'Corps' }
        })
      )
    ).toEqual({
      retenu: true,
      depose: false,
      titre: 'Titre',
      texte: 'Corps',
      issue: 'Brain injoignable : gardé dans ce fil'
    })
  })

  it('distingue un fait déposé au Brain d’un fait seulement gardé dans le fil', () => {
    const fait = { title: 'Titre', body: 'Corps' }
    expect(
      lireFaitRetenu(JSON.stringify({ allowed: true, stored: true, fact: fait }))
    ).toMatchObject({ retenu: true, depose: true })
    // Réponse réelle de conv-927 (2026-10-13) : validé localement, refusé par le Brain.
    expect(
      lireFaitRetenu(
        JSON.stringify({
          allowed: true,
          stored: false,
          detail: 'refusé par le Brain : likely personal data detected; candidate rejected',
          fact: fait
        })
      )
    ).toMatchObject({
      retenu: true,
      depose: false,
      issue: 'refusé par le Brain : likely personal data detected; candidate rejected'
    })
  })

  it('rend le motif d’un refus ou d’un doublon, sans texte de fait', () => {
    expect(lireFaitRetenu(JSON.stringify({ allowed: false, reason: 'titre manquant' }))).toEqual({
      retenu: false,
      motif: 'titre manquant'
    })
    expect(
      lireFaitRetenu(
        JSON.stringify({ stored: false, note: 'duplicate', detail: 'aucun doublon écrit' })
      )
    ).toEqual({ retenu: false, motif: 'aucun doublon écrit' })
  })

  it('ne rend rien d’un contenu qui n’est pas une réponse lisible', () => {
    expect(lireFaitRetenu('{"title": "coupé')).toBeUndefined()
    expect(lireFaitRetenu('"texte"')).toBeUndefined()
    expect(
      lireFaitRetenu(JSON.stringify({ allowed: true, fact: { title: 'sans corps' } }))
    ).toBeUndefined()
  })
})

describe('lireReponseRemember — réponse réussie OU en échec', () => {
  it('lit une réponse en échec : la trace range un dépôt refusé en `error`', () => {
    expect(
      lireReponseRemember({
        kind: 'error',
        content: JSON.stringify({ allowed: false, stored: false, reason: 'source invalide' })
      })
    ).toEqual({ retenu: false, motif: 'source invalide' })
  })

  it('une exception levée par la commande est son propre motif', () => {
    expect(lireReponseRemember({ kind: 'error', content: 'Brain : délai dépassé' })).toEqual({
      retenu: false,
      motif: 'Brain : délai dépassé'
    })
  })

  it('un résultat réussi illisible reste illisible : aucun motif inventé', () => {
    expect(lireReponseRemember({ kind: 'tool-result', content: 'pas du JSON' })).toBeUndefined()
  })
})
