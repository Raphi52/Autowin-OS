import { describe, expect, it } from 'vitest'
import { boutId, degre, deuxiemeSaut, voisinsDirects } from './graph-neighborhood'
import type { GraphNode } from './graph-view-model'

const noeud = (id: string): GraphNode => ({ id, label: id }) as GraphNode
const parId = new Map(['a', 'b', 'c', 'd', 'e'].map((id) => [id, noeud(id)]))
const liens = [
  { source: 'a', target: 'b', relation: 'cite' },
  { source: 'c', target: 'a' },
  { source: 'b', target: 'd' },
  { source: 'c', target: 'e' }
]

describe('boutId', () => {
  it('lit l’identifiant qu’il soit une chaîne ou l’objet nœud rendu par la vue 3D', () => {
    expect(boutId('a')).toBe('a')
    expect(boutId({ id: 'b' })).toBe('b')
    expect(boutId({})).toBe('')
  })
})

describe('voisinsDirects', () => {
  it('rend le sens du lien et sa relation', () => {
    expect(voisinsDirects('a', liens)).toEqual([
      { id: 'b', direction: 'outgoing', relation: 'cite' },
      { id: 'c', direction: 'incoming' }
    ])
  })
})

describe('degre', () => {
  it('compte séparément ce qui entre et ce qui sort', () => {
    expect(degre('a', liens)).toEqual({ entrants: 1, sortants: 1 })
    expect(degre('c', liens)).toEqual({ entrants: 0, sortants: 2 })
  })
})

describe('deuxiemeSaut', () => {
  it('rend les nœuds atteints en deux liens, avec le relais par lequel on y arrive', () => {
    expect(deuxiemeSaut('a', liens, parId).map((saut) => [saut.node.id, saut.via.id])).toEqual([
      ['d', 'b'],
      ['e', 'c']
    ])
  })

  it('n’inclut ni le nœud courant ni ses voisins directs', () => {
    const ids = deuxiemeSaut('a', liens, parId).map((saut) => saut.node.id)
    expect(ids).not.toContain('a')
    expect(ids).not.toContain('b')
    expect(ids).not.toContain('c')
  })

  it('ignore un voisin dont le nœud n’est pas dans la vue chargée', () => {
    expect(deuxiemeSaut('a', liens, new Map([['b', noeud('b')]]))).toEqual([])
  })
})
