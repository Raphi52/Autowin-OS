import { describe, expect, it } from 'vitest'
import { fichiersEcritsDuProjet } from './aides-du-tour'

describe('fichiersEcritsDuProjet — ce qu’un appel a écrit dans le projet', () => {
  it('écarte les scripts jetables et les données de l’app, à tout niveau du chemin', () => {
    expect(
      fichiersEcritsDuProjet([
        '.autowin-tmp/conv-1/sonde.mjs',
        '.autowin-data\\autowin-os\\besoins.jsonl',
        'outils/.autowin-tmp/x.ts',
        'src/main/a.ts'
      ])
    ).toEqual(['src/main/a.ts'])
  })

  it('rend chaque fichier une fois, quelle que soit la casse ou la barre', () => {
    expect(fichiersEcritsDuProjet(['src\\Main\\A.ts', 'src/main/a.ts', ' ', 'README.md'])).toEqual([
      'src/Main/A.ts',
      'README.md'
    ])
  })

  it('un appel qui n’a écrit que du jetable n’a rien écrit dans le projet', () => {
    expect(fichiersEcritsDuProjet(['.autowin-tmp/a.js'])).toEqual([])
    expect(fichiersEcritsDuProjet([])).toEqual([])
  })
})
