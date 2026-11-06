import { describe, expect, it } from 'vitest'
import { lireArguments, reglesDuCommentaire } from './derogations-lint.mjs'

describe('derogations-lint (conv-1654)', () => {
  it('lit les règles d’un commentaire de fichier entier, sans la justification', () => {
    expect(
      reglesDuCommentaire(
        '/* eslint-disable react-hooks/refs, react-hooks/immutability, react-hooks/set-state-in-effect -- (conv-1508) le code, déplacé tel quel. */'
      )
    ).toEqual(['react-hooks/refs', 'react-hooks/immutability', 'react-hooks/set-state-in-effect'])
  })

  it('lit une dérogation de ligne suivante avec ou sans raison', () => {
    expect(
      reglesDuCommentaire('  // eslint-disable-next-line react-hooks/exhaustive-deps')
    ).toEqual(['react-hooks/exhaustive-deps'])
    expect(reglesDuCommentaire('x() // eslint-disable-line no-console -- trace voulue')).toEqual([
      'no-console'
    ])
  })

  it('ignore une mention de eslint-disable dans une phrase', () => {
    expect(reglesDuCommentaire("// le ` qui vivait ici faisait taire l'avertissement")).toEqual([])
    expect(reglesDuCommentaire('// on a retiré le eslint-disable qui vivait ici')).toEqual([])
  })

  it('sépare le filtre de règle des fichiers', () => {
    expect(lireArguments(['--regle', 'react-hooks/', 'a.tsx', '--json'])).toEqual({
      regle: 'react-hooks/',
      json: true,
      fichiers: ['a.tsx']
    })
  })
})
