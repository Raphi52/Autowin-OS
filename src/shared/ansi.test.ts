import { describe, expect, it } from 'vitest'
import { sansSequencesAnsi } from './ansi'

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)

describe('sansSequencesAnsi', () => {
  it('retire une sequence de couleur complete', () => {
    expect(sansSequencesAnsi(ESC + '[31m FAIL ' + ESC + '[39m src/a.test.ts')).toBe(
      ' FAIL  src/a.test.ts'
    )
  })

  /*
   * LE CAS QUI A PRODUIT LES CARRES A L'ECRAN : un depouillement sans l'ancre `<ESC>` retire `[31m`
   * et laisse l'octet seul. Une assertion ecrite sur `<ESC>[` passe alors au vert. On exige donc
   * qu'aucun echappement ne survive, meme orphelin.
   */
  it('retire un echappement ORPHELIN, reste d un depouillement partiel', () => {
    expect(sansSequencesAnsi(ESC + ' e2e — du message de chat')).toBe(' e2e — du message de chat')
  })

  it('ne mange PAS un crochet legitime du message', () => {
    expect(sansSequencesAnsi('items[3] est vide — [1/10]')).toBe('items[3] est vide — [1/10]')
  })

  it("retire une sequence de titre de fenetre sans avaler la suite", () => {
    expect(sansSequencesAnsi(ESC + ']0;titre' + BEL + 'apres')).toBe('apres')
  })

  it('laisse un texte propre identique a lui-meme', () => {
    expect(sansSequencesAnsi('Tests 412/900')).toBe('Tests 412/900')
  })
})
