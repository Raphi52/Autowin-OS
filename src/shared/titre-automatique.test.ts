import { describe, expect, it } from 'vitest'
import {
  TITRE_PROVISOIRE,
  texteQuiNomme,
  titreApresMessage,
  titreEstAutomatique,
  titreReprisDuMessage
} from './titre-automatique'

const QUAND = new Date(2026, 9, 16, 10, 5)

/** Demande du 2026-10-16 (conv-999) : le titre suit le DERNIER message, sauf nom donné à la main. */
describe('titre automatique — il suit le dernier message', () => {
  it('reprend le nouveau message quand le titre venait du premier', () => {
    expect(
      titreApresMessage({
        titre: 'corrige le bouton Stop',
        premierMessage: 'corrige le bouton Stop',
        message: 'ajoute un export CSV des runs',
        autresTitres: [],
        quand: QUAND
      })
    ).toBe('ajoute un export CSV des runs')
  })

  it('ne touche JAMAIS un nom donné à la main', () => {
    expect(
      titreApresMessage({
        titre: 'Factures client',
        origine: 'utilisateur',
        premierMessage: 'Factures client',
        message: 'ajoute un export CSV',
        autresTitres: [],
        quand: QUAND
      })
    ).toBeUndefined()
  })

  it('une relance sans objet (« go », « ok », « reprend ») ne renomme pas', () => {
    for (const relance of ['go', 'ok', 'reprend', 'vas-y stp', 'continue']) {
      expect(
        titreApresMessage({
          titre: 'ajoute un export CSV',
          origine: 'auto',
          message: relance,
          autresTitres: [],
          quand: QUAND
        })
      ).toBeUndefined()
    }
  })

  it('date le titre quand un autre fil porte déjà le même', () => {
    const titre = titreApresMessage({
      titre: TITRE_PROVISOIRE,
      message: '/salvage',
      autresTitres: ['/salvage'],
      quand: QUAND
    })
    expect(titre).toBe('/salvage · 16/10 10:05')
  })

  it('rend undefined quand le titre ne change pas', () => {
    expect(
      titreApresMessage({
        titre: 'ajoute un export CSV',
        origine: 'auto',
        message: 'ajoute   un export CSV',
        autresTitres: [],
        quand: QUAND
      })
    ).toBeUndefined()
  })
})

describe('fil antérieur à la règle (sans origineTitre) — seul son titre dit s il a été choisi', () => {
  const premier = 'liste moi 100 inconvénients de autowin OS et classe-les par gravité'

  it('reconnaît les titres repris du premier message : coupe à 42, à 80 au mot, avec date', () => {
    expect(titreReprisDuMessage('liste moi 100 inconvénients de autowin O…', premier)).toBe(true)
    expect(titreReprisDuMessage(premier, premier)).toBe(true)
    expect(titreReprisDuMessage('liste moi 100 inconvénients d… · 12/09 09:41', premier)).toBe(true)
    expect(titreReprisDuMessage('Liste Moi 100 Inconvenients', premier)).toBe(true)
  })

  it('un titre qui ne vient pas du premier message est un nom choisi : on le garde', () => {
    expect(titreEstAutomatique({ titre: 'Audit qualité', premierMessage: premier })).toBe(false)
    expect(titreEstAutomatique({ titre: 'liste moi 100…', premierMessage: premier })).toBe(true)
    expect(titreEstAutomatique({ titre: TITRE_PROVISOIRE })).toBe(true)
    expect(titreEstAutomatique({ titre: 'Audit', premierMessage: '' })).toBe(false)
  })

  it('un message sans texte est nommé par sa première pièce jointe', () => {
    expect(texteQuiNomme({ content: '  ', attachments: [{ name: 'capture.png' }] })).toBe(
      'capture.png'
    )
    expect(texteQuiNomme({ content: 'a\n\n b' })).toBe('a b')
  })
})
