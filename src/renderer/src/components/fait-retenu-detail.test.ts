import { describe, expect, it } from 'vitest'
import { lireFaitRetenu } from './fait-retenu-detail'

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
      titre: 'Titre',
      texte: 'Corps',
      issue: 'Brain injoignable : gardé dans ce fil'
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
