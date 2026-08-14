import { describe, expect, it } from 'vitest'
import { computeGitGraphElisions } from './git-graph'

/**
 * Le CALCUL des sauts de la ligne principale, isolé de git.
 *
 * MESURÉ le 2026-08-14 sur ce dépôt : 577 commits de première lignée, 125 affichés, 23 sauts — 0 à
 * l'intérieur de la fenêtre des 240 récents, 23 impliquant un îlot décoré hors fenêtre (le plus large
 * omettant 181 commits). Ces cas sont reproduits ici en clair.
 */
describe('computeGitGraphElisions', () => {
  it('ne signale RIEN quand la ligne affichée est contiguë', () => {
    // Le haut du graphe, mesuré continu : 0 saut dans la fenêtre récente.
    const ligne = ['c1', 'c2', 'c3', 'c4']
    expect(computeGitGraphElisions(ligne, new Set(ligne))).toEqual([])
  })

  it('COMPTE les commits omis entre deux commits affichés', () => {
    const ligne = ['c1', 'x1', 'x2', 'x3', 'c2']
    expect(computeGitGraphElisions(ligne, new Set(['c1', 'c2']))).toEqual([
      { from: 'c1', to: 'c2', omis: 3 }
    ])
  })

  it('signale CHAQUE saut, pas seulement le premier', () => {
    const ligne = ['a', 'x', 'b', 'y', 'z', 'c']
    expect(computeGitGraphElisions(ligne, new Set(['a', 'b', 'c']))).toEqual([
      { from: 'a', to: 'b', omis: 1 },
      { from: 'b', to: 'c', omis: 2 }
    ])
  })

  it('IGNORE ce qui précède le premier affiché et suit le dernier', () => {
    // Un saut se mesure ENTRE deux points visibles. Sans borne visible en face, il n'y a pas de
    // segment à dessiner — annoncer « ⋯ N commits » dans le vide serait du bruit.
    const ligne = ['vieux1', 'vieux2', 'affiche', 'jeune1']
    expect(computeGitGraphElisions(ligne, new Set(['affiche']))).toEqual([])
  })

  it('reste vide sur une ligne vide, sans jeter', () => {
    expect(computeGitGraphElisions([], new Set())).toEqual([])
  })
})
