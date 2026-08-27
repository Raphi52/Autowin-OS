import { describe, expect, it } from 'vitest'
import { cheminDeStatutPorcelain } from './worktree-manager'

/**
 * Pourquoi ce parseur existe, et pourquoi il est testé À PART.
 *
 * L'aperçu des travaux non publiés lit `git status --porcelain` pour nommer les fichiers d'un bureau
 * jamais committé. La découpe naïve — trois caractères en dur — se casse sur un détail : le lanceur
 * git de ce module TRIME sa sortie (worktree-manager.ts:112), donc la PREMIÈRE ligne perd son espace
 * de tête et se décale d'un cran. Mesuré le 2026-08-26 : l'aperçu rendait « rc/renderer/… » et
 * « cripts/probe… » — des chemins qui n'existent nulle part.
 *
 * Testé unitairement PARCE QUE le test d'intégration ne l'attrapait pas : sur un bureau de test, le
 * décalage ne se produit que si la première ligne est un fichier SUIVI et modifié. Un test qui ne
 * peut pas voir le défaut ne le protège pas — vérifié par sabotage, la découpe fautive réintroduite
 * fait bien tomber ces cas-ci, et ne faisait pas tomber l'autre.
 */
describe('cheminDeStatutPorcelain — le chemin, quel que soit le statut qui le précède', () => {
  it('rend le chemin d’une ligne TRIMÉE, dont l’espace de tête a disparu', () => {
    // Le cas qui a produit « rc/renderer/… » : ` M src/…` trimé devient `M src/…`.
    expect(cheminDeStatutPorcelain('M  src/renderer/src/components/HomeView.css')).toBe(
      'src/renderer/src/components/HomeView.css'
    )
    expect(cheminDeStatutPorcelain('M a.txt')).toBe('a.txt')
  })

  it('rend le chemin d’une ligne INTACTE, espace de tête compris', () => {
    expect(cheminDeStatutPorcelain(' M src/main/index.ts')).toBe('src/main/index.ts')
    expect(cheminDeStatutPorcelain('?? scripts/probe.mjs')).toBe('scripts/probe.mjs')
    expect(cheminDeStatutPorcelain('A  nouveau.ts')).toBe('nouveau.ts')
  })

  it('rend le NOUVEAU nom d’un renommage — le seul qui existe encore sur le disque', () => {
    expect(cheminDeStatutPorcelain('R  ancien.ts -> nouveau.ts')).toBe('nouveau.ts')
  })

  it('ne mange jamais la première lettre d’un chemin', () => {
    // L'invariant qui résume le défaut : aucun chemin rendu ne doit être un SUFFIXE strict du chemin
    // d'origine. C'est ce que « rc/renderer » était.
    for (const [ligne, attendu] of [
      ['M  src/a.ts', 'src/a.ts'],
      [' M src/a.ts', 'src/a.ts'],
      ['?? scripts/b.mjs', 'scripts/b.mjs'],
      ['MM src/c.ts', 'src/c.ts']
    ] as const) {
      expect(cheminDeStatutPorcelain(ligne)).toBe(attendu)
    }
  })

  it('rend une chaîne vide sur une ligne vide, sans inventer de chemin', () => {
    expect(cheminDeStatutPorcelain('')).toBe('')
  })
})
