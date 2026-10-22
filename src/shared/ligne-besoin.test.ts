import { describe, expect, it } from 'vitest'
import { lireLigneBesoin } from './ligne-besoin'
import { retirerLignePromptSuivant } from './prompt-suivant'

describe('ligne de besoin (carte des besoins, lot 2)', () => {
  it('lit les quatre formes', () => {
    expect(lireLigneBesoin('Réponse.\nAUTOWIN_BESOIN_V1: nouveau')).toEqual({ nature: 'nouveau' })
    expect(lireLigneBesoin('AUTOWIN_BESOIN_V1: suite')).toEqual({ nature: 'suite' })
    expect(lireLigneBesoin('AUTOWIN_BESOIN_V1: suite conv-1059')).toEqual({
      nature: 'suite',
      de: 'conv-1059'
    })
    expect(lireLigneBesoin('AUTOWIN_BESOIN_V1: aucun')).toEqual({ nature: 'aucun' })
  })

  it('tolère le gras, les backticks, la casse et « suite de conv-N »', () => {
    expect(lireLigneBesoin('`AUTOWIN_BESOIN_V1: Suite de conv-12.`')).toEqual({
      nature: 'suite',
      de: 'conv-12'
    })
    expect(lireLigneBesoin('**AUTOWIN_BESOIN_V1: NOUVEAU**')).toEqual({ nature: 'nouveau' })
  })

  it('ignore une valeur inconnue ou une référence hors « suite »', () => {
    expect(lireLigneBesoin('AUTOWIN_BESOIN_V1: peut-être')).toBeNull()
    expect(lireLigneBesoin('AUTOWIN_BESOIN_V1: nouveau conv-3')).toBeNull()
    expect(lireLigneBesoin('aucune ligne ici')).toBeNull()
    expect(lireLigneBesoin(undefined)).toBeNull()
  })

  it('ne lit pas un exemple cité dans un bloc de code, et garde la dernière ligne lisible', () => {
    const texte = [
      '```',
      'AUTOWIN_BESOIN_V1: nouveau',
      '```',
      'AUTOWIN_BESOIN_V1: suite',
      'AUTOWIN_BESOIN_V1: illisible'
    ].join('\n')
    expect(lireLigneBesoin(texte)).toEqual({ nature: 'suite' })
    expect(lireLigneBesoin('```\nAUTOWIN_BESOIN_V1: nouveau\n```')).toBeNull()
  })

  it("disparaît de l'affichage, y compris en cours de streaming, mais pas dans un bloc de code", () => {
    const fin = [
      '👉 Recommandé',
      'Construire le lot 3.',
      'AUTOWIN_BESOIN_V1: suite',
      'AUTOWIN_PROMPT_V1: [80] Construis le lot 3.'
    ].join('\n')
    expect(retirerLignePromptSuivant(fin)).toBe('👉 Recommandé\nConstruire le lot 3.')
    // Préfixe partiel du marqueur, tel qu'il arrive caractère par caractère.
    expect(retirerLignePromptSuivant('Texte\nAUTOWIN_BES')).toBe('Texte')
    // Même une ligne mal formée reste invisible : c'est une ligne technique, pas du contenu.
    expect(retirerLignePromptSuivant('Texte\nAUTOWIN_BESOIN_V1: ???')).toBe('Texte')
    const cite = '```\nAUTOWIN_BESOIN_V1: nouveau\n```'
    expect(retirerLignePromptSuivant(cite)).toBe(cite)
  })
})
