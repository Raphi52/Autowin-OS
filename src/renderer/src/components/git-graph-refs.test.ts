import { describe, expect, it } from 'vitest'
import { brancheDeCommit, parserRefsCommit } from './git-graph-refs'

/**
 * LES ÉTIQUETTES DE BRANCHE, telles que SourceTree les pose sur la ligne du commit.
 *
 * `git log --decorate` rend une chaîne brute : `HEAD -> main`, `origin/main`, `tag: v1.0`. Affichée
 * telle quelle, elle est illisible ; jetée, on perd la seule chose qui dit OÙ on est.
 */
describe('parserRefsCommit', () => {
  it('sépare la tête, la branche locale, la distante et l’étiquette', () => {
    expect(parserRefsCommit(['HEAD -> main', 'origin/main', 'tag: v1.0'])).toEqual([
      { libelle: 'main', genre: 'head' },
      { libelle: 'origin/main', genre: 'remote' },
      { libelle: 'v1.0', genre: 'tag' }
    ])
  })

  it('reconnaît une branche locale simple', () => {
    expect(parserRefsCommit(['feat/cockpit'])).toEqual([
      { libelle: 'feat/cockpit', genre: 'local' }
    ])
  })

  /** CAS LIMITE — `HEAD` détachée : c'est une information, pas une branche. */
  it('garde HEAD détachée comme telle', () => {
    expect(parserRefsCommit(['HEAD'])).toEqual([{ libelle: 'HEAD', genre: 'head' }])
  })

  /** CAS LIMITE — décorations vides ou blanches : rien à afficher, aucune pastille fantôme. */
  it('ignore les décorations vides', () => {
    expect(parserRefsCommit(['', '   '])).toEqual([])
    expect(parserRefsCommit([])).toEqual([])
  })

  /** CAS LIMITE — `grafted` / `replaced` : décorations techniques de git, pas des branches. */
  it('écarte les décorations techniques de git', () => {
    expect(parserRefsCommit(['grafted', 'replaced'])).toEqual([])
  })
})

describe('brancheDeCommit — la clé de couleur d’une voie', () => {
  it('préfère la branche locale à la distante', () => {
    expect(brancheDeCommit(['origin/main', 'HEAD -> main'])).toBe('main')
  })

  it('retombe sur la distante quand aucune locale n’existe', () => {
    expect(brancheDeCommit(['origin/feat/x'])).toBe('origin/feat/x')
  })

  it('ne prend PAS une étiquette pour une branche', () => {
    // Une étiquette `rescue/...` est posée par l'app sur des commits orphelins : colorer une voie
    // entière d'après elle ferait clignoter la couleur d'une branche au gré des sauvetages.
    expect(brancheDeCommit(['tag: rescue/2026-09'])).toBeUndefined()
  })
})
