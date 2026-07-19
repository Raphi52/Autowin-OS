import { describe, it, expect } from 'vitest'
import { normalize, filterByCommunity, topByDegree, type RawGraph } from './graph'

describe('normalize', () => {
  it('applique les défauts (label=id, group=0, weight=1) quand les champs optionnels sont absents', () => {
    const raw: RawGraph = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }]
    }
    const g = normalize(raw)
    expect(g.nodes).toEqual([
      { id: 'a', label: 'a', group: 0, file: undefined },
      { id: 'b', label: 'b', group: 0, file: undefined }
    ])
    expect(g.links).toEqual([{ source: 'a', target: 'b', weight: 1 }])
  })

  it('reprend les champs explicites quand ils sont fournis', () => {
    const raw: RawGraph = {
      nodes: [{ id: 'a', label: 'Nœud A', community: 2, source_file: 'a.ts' }],
      links: []
    }
    const g = normalize(raw)
    expect(g.nodes[0]).toEqual({ id: 'a', label: 'Nœud A', group: 2, file: 'a.ts' })
  })

  it('ignore un lien orphelin (source ou target absent des nœuds)', () => {
    const raw: RawGraph = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'ghost' },
        { source: 'ghost', target: 'b' }
      ]
    }
    const g = normalize(raw)
    expect(g.links).toEqual([{ source: 'a', target: 'b', weight: 1 }])
  })

  it('gère un graphe vide', () => {
    const g = normalize({ nodes: [], links: [] })
    expect(g).toEqual({ nodes: [], links: [] })
  })
})

describe('filterByCommunity', () => {
  it('isole une communauté : ses nœuds + uniquement les liens internes', () => {
    const raw: RawGraph = {
      nodes: [
        { id: 'a', community: 1 },
        { id: 'b', community: 1 },
        { id: 'c', community: 2 }
      ],
      links: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' }
      ]
    }
    const g = normalize(raw)
    const filtered = filterByCommunity(g, 1)
    expect(filtered.nodes.map((n) => n.id)).toEqual(['a', 'b'])
    expect(filtered.links).toEqual([{ source: 'a', target: 'b', weight: 1 }])
  })

  it('retourne un graphe vide si la communauté ne contient aucun nœud', () => {
    const g = normalize({ nodes: [{ id: 'a', community: 1 }], links: [] })
    const filtered = filterByCommunity(g, 99)
    expect(filtered).toEqual({ nodes: [], links: [] })
  })
})

describe('topByDegree', () => {
  it('trie les nœuds par degré décroissant (liens entrants + sortants)', () => {
    // a: 2 liens (vers b, vers c) — b: 2 liens (depuis a, vers c) — c: 2 liens (depuis a, depuis b)
    // hub: on ajoute un nœud isolé "d" avec degré 0, et on renforce "a" à 3
    const raw: RawGraph = {
      nodes: [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }],
      links: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
        { source: 'a', target: 'd' },
        { source: 'b', target: 'c' }
      ]
    }
    const g = normalize(raw)
    const top = topByDegree(g, 2)
    // degrés : a=3, b=2, c=2, d=1 -> tri stable, a d'abord puis b (ex-aequo b/c gardent l'ordre d'origine)
    expect(top.map((n) => n.id)).toEqual(['a', 'b'])
  })

  it('retourne tous les nœuds triés quand n dépasse la taille du graphe', () => {
    const raw: RawGraph = {
      nodes: [{ id: 'a' }, { id: 'b' }],
      links: [{ source: 'a', target: 'b' }]
    }
    const g = normalize(raw)
    const top = topByDegree(g, 50)
    expect(top).toHaveLength(2)
    expect(top.map((n) => n.id).sort()).toEqual(['a', 'b'])
  })

  it('gère un graphe vide (retourne un tableau vide)', () => {
    const g = normalize({ nodes: [], links: [] })
    expect(topByDegree(g, 5)).toEqual([])
  })
})
