import { describe, expect, it } from 'vitest'
import { creerCoupeBoucle, sortieComparable } from './coupe-boucle'

/** Le résultat d'un Read d'image tel que Claude le rend : un bloc image, aucun texte. */
const lectureDImage = (donnees: string): unknown => [
  { type: 'image', source: { type: 'base64', media_type: 'image/png', data: donnees } }
]

/*
 * Lot 2 du plan-9817a640 (13/11/2026) : photo → correction → nouvelle photo, au même chemin. Le
 * résultat d'un Read d'image n'a pas de texte : les 4 lectures d'images DIFFÉRENTES passaient pour
 * « le même résultat », et 73 minutes de travail ont été coupées en « boucle détectée ».
 */
describe('sortieComparable — ce que le coupe-circuit compare', () => {
  it('une photo refaite au même chemin n’est pas le même résultat', () => {
    const c = creerCoupeBoucle()
    const entree = { file_path: 'D:/jeu/qualite/cartes-portable.png' }
    for (let i = 0; i < 6; i++)
      expect(
        c.observer('Read', entree, false, sortieComparable(lectureDImage(`photo-${i}`)))
      ).toBeUndefined()
  })

  it('jumeau : la MÊME image relue 4 fois reste une boucle', () => {
    const c = creerCoupeBoucle()
    const entree = { file_path: 'D:/jeu/qualite/cartes-portable.png' }
    const meme = sortieComparable(lectureDImage('identique'))
    for (let i = 0; i < 3; i++) expect(c.observer('Read', entree, false, meme)).toBeUndefined()
    expect(c.observer('Read', entree, false, meme)).toMatch(/4 fois/)
  })

  it('garde le texte tel quel, et ajoute une empreinte courte par image', () => {
    expect(sortieComparable('sortie')).toBe('sortie')
    expect(
      sortieComparable([
        { type: 'text', text: 'a' },
        { type: 'text', text: 'b' }
      ])
    ).toBe('a\nb')
    const avecImage = sortieComparable([
      { type: 'text', text: 'vu' },
      ...(lectureDImage('x') as [])
    ])
    expect(avecImage).toMatch(/^vu\n\[image [0-9a-f]{16}\]$/)
    expect(sortieComparable(undefined)).toBe('')
  })
})

describe('coupeBoucle', () => {
  it('coupe au 4e appel identique au même résultat', () => {
    const c = creerCoupeBoucle()
    for (let i = 0; i < 3; i++)
      expect(c.observer('Bash', { command: 'ls' }, false, 'a')).toBeUndefined()
    expect(c.observer('Bash', { command: 'ls' }, false, 'a')).toMatch(/4 fois/)
  })

  it('ne coupe pas si le résultat change', () => {
    const c = creerCoupeBoucle()
    for (let i = 0; i < 10; i++)
      expect(c.observer('Bash', { command: 'ls' }, false, `r${i}`)).toBeUndefined()
  })

  it('coupe après 8 échecs d’affilée, un succès remet à zéro', () => {
    const c = creerCoupeBoucle()
    for (let i = 0; i < 7; i++) expect(c.observer('Read', { i }, true, `e${i}`)).toBeUndefined()
    expect(c.observer('Read', { ok: 1 }, false, 'ok')).toBeUndefined()
    for (let i = 0; i < 7; i++) expect(c.observer('Read', { j: i }, true, `x${i}`)).toBeUndefined()
    expect(c.observer('Read', { j: 99 }, true, 'x')).toMatch(/8 outils en échec/)
  })
})
