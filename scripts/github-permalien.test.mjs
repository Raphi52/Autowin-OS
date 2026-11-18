import { describe, expect, it } from 'vitest'
import { lignesCorrespondantes, permalien, lireArguments } from './github-permalien.mjs'

describe('permalien', () => {
  it('ancre la ligne sur le commit, pas sur la branche', () => {
    expect(
      permalien('anthropics/skills', 'e4bb5d960d', 'skills/frontend-design/SKILL.md', 53)
    ).toBe(
      'https://github.com/anthropics/skills/blob/e4bb5d960d/skills/frontend-design/SKILL.md#L53'
    )
  })
})

describe('lignesCorrespondantes', () => {
  const texte = ['# Titre', 'Take screenshots to review', 'rien', 'SCREENSHOT final'].join('\n')

  it('rend le numéro de ligne (1 = première) et ignore la casse', () => {
    expect(lignesCorrespondantes(texte, 'screenshot')).toEqual([
      { ligne: 2, texte: 'Take screenshots to review' },
      { ligne: 4, texte: 'SCREENSHOT final' }
    ])
  })

  it('ne rend rien quand le motif est absent', () => {
    expect(lignesCorrespondantes(texte, 'lighthouse')).toEqual([])
  })
})

describe('lireArguments', () => {
  it('lit dépôt, chemin, référence et motif', () => {
    expect(lireArguments(['o/r', 'docs/a.md', '--ref', 'v1', '--motif', 'x|y', '--json'])).toEqual({
      depot: 'o/r',
      chemin: 'docs/a.md',
      ref: 'v1',
      motif: 'x|y',
      json: true
    })
  })

  it('refuse un dépôt sans propriétaire', () => {
    expect(() => lireArguments(['skills', 'a.md'])).toThrow(/propriétaire\/dépôt/)
  })
})
