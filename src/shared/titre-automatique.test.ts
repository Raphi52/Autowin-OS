import { describe, expect, it } from 'vitest'
import {
  TITRE_PROVISOIRE,
  texteQuiNomme,
  titreApresMessage,
  titreEstProvisoire
} from './titre-automatique'

const QUAND = new Date(2026, 9, 16, 10, 5)

/**
 * Le titre est celui du PREMIER message, puis il ne bouge plus. « Le titre suit le dernier
 * message » (conv-999) a été annulé le 2026-10-28 (conv-1203).
 */
describe('titre automatique — seul un fil provisoire prend un nom', () => {
  it('nomme un fil provisoire d après son message', () => {
    expect(
      titreApresMessage({
        titre: TITRE_PROVISOIRE,
        message: 'ajoute un export CSV des runs',
        autresTitres: [],
        quand: QUAND
      })
    ).toBe('ajoute un export CSV des runs')
  })

  it('ne renomme PLUS un fil déjà nommé par son premier message', () => {
    expect(
      titreApresMessage({
        titre: 'corrige le bouton Stop',
        origine: 'auto',
        message: 'ajoute un export CSV des runs',
        autresTitres: [],
        quand: QUAND
      })
    ).toBeUndefined()
  })

  it('ne touche JAMAIS un nom donné à la main', () => {
    expect(
      titreApresMessage({
        titre: 'Factures client',
        origine: 'utilisateur',
        message: 'ajoute un export CSV',
        autresTitres: [],
        quand: QUAND
      })
    ).toBeUndefined()
  })

  it('une relance sans objet (« go », « ok », « reprend ») ne nomme pas un fil provisoire', () => {
    for (const relance of ['go', 'ok', 'reprend', 'vas-y stp', 'continue']) {
      expect(
        titreApresMessage({
          titre: TITRE_PROVISOIRE,
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

  it('reconnaît le titre provisoire', () => {
    expect(titreEstProvisoire(TITRE_PROVISOIRE)).toBe(true)
    expect(titreEstProvisoire('   ')).toBe(true)
    expect(titreEstProvisoire('Audit qualité')).toBe(false)
  })

  it('un message sans texte est nommé par sa première pièce jointe', () => {
    expect(texteQuiNomme({ content: '  ', attachments: [{ name: 'capture.png' }] })).toBe(
      'capture.png'
    )
    expect(texteQuiNomme({ content: 'a\n\n b' })).toBe('a b')
  })
})
