import { describe, expect, it } from 'vitest'
import { layoutGitGraph, type GitGraphLayoutAxes } from './GitGraphLayout'
import type { GitGraphCommit } from '../../../shared/git-graph'

/**
 * LES CASSURES DE LA LIGNE PRINCIPALE — une élision qui se lisait comme une donnée cassée.
 *
 * Il n'existe aucune colonne dessinée : la ligne principale est la SOMME des segments parent→enfant,
 * et une arête n'est émise que si le parent fait partie des commits chargés. Une arête manquante
 * produit donc un TROU, visuellement indistinguable d'un graphe corrompu.
 *
 * Or ce trou est normal et voulu. Le jeu chargé vient de DEUX requêtes : les N commits les plus
 * récents, PUIS les commits porteurs d'une ref à n'importe quelle profondeur (`--simplify-by-decoration`),
 * ajoutés SANS leurs ancêtres. Ces vieux points d'ancrage sont donc des îlots.
 *
 * MESURÉ le 2026-08-14 sur ce dépôt : 577 commits de première lignée, 125 affichés, 23 cassures — et
 * la répartition tranche entre les deux causes possibles : 0 cassure à l'intérieur de la fenêtre des
 * 240 récents, 23 impliquant un îlot décoré hors fenêtre (dont un saut de 181 commits). Le haut du
 * graphe est donc parfaitement continu ; c'est sous la fenêtre que la ligne se pointille.
 *
 * Ce qui manquait n'était pas de la donnée mais un SIGNE : le graphe omet délibérément cette histoire
 * et ne le disait pas. Ces tests exigent une arête d'élision, marquée et COMPTÉE.
 */

function commit(hash: string, parent?: string): GitGraphCommit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    parents: parent ? [parent] : [],
    subject: `sujet ${hash}`,
    author: 'T',
    date: '2026-08-14T00:00:00Z',
    refs: []
  } as unknown as GitGraphCommit
}

/** Deux commits de la ligne principale dont le parent immédiat n'est PAS chargé. */
function scene(): { commits: GitGraphCommit[]; axes: GitGraphLayoutAxes } {
  const commits = [commit('recent1', 'manquant'), commit('ancien1')]
  return {
    commits,
    axes: { main: new Set(['recent1', 'ancien1']), ouvertes: new Set() }
  }
}

describe('élisions de la ligne principale', () => {
  it('relie deux commits principaux séparés par une histoire NON chargée', () => {
    const { commits, axes } = scene()
    const layout = layoutGitGraph(commits, axes, [{ from: 'recent1', to: 'ancien1', omis: 27 }])
    const elidee = layout.edges.find((edge) => edge.elidee)
    expect(elidee).toBeDefined()
    expect(elidee!.from.commit.hash).toBe('recent1')
    expect(elidee!.to.commit.hash).toBe('ancien1')
  })

  it('PORTE le nombre de commits omis : « ⋯ » sans chiffre n’informe pas', () => {
    const { commits, axes } = scene()
    const layout = layoutGitGraph(commits, axes, [{ from: 'recent1', to: 'ancien1', omis: 27 }])
    expect(layout.edges.find((edge) => edge.elidee)?.omis).toBe(27)
  })

  it('n’invente AUCUNE arête quand aucune élision n’est fournie', () => {
    // La régression à craindre : relier systématiquement les commits principaux voisins ferait
    // apparaître une ligne continue là où l'histoire est réellement absente — un mensonge inverse.
    const { commits, axes } = scene()
    expect(layoutGitGraph(commits, axes).edges.filter((edge) => edge.elidee)).toEqual([])
  })

  it('ne marque PAS élidée une arête parent→enfant réelle', () => {
    const commits = [commit('b', 'a'), commit('a')]
    const layout = layoutGitGraph(commits, { main: new Set(['a', 'b']), ouvertes: new Set() })
    expect(layout.edges).toHaveLength(1)
    expect(layout.edges[0].elidee).toBeFalsy()
  })
})
