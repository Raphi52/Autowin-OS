import { describe, expect, it } from 'vitest'
import { filtrerGrapheParAffichage, type GraphData, type GraphNode } from './graph-view-model'

const equipe = (id: string): GraphNode => ({ id, label: id, group: 0 })
const perso = (id: string): GraphNode => ({ id: `perso:${id}`, label: id, group: 0, perso: true })

const typecheck = equipe('knowledge/typecheck')
const lint = equipe('knowledge/lint')
const typage = perso('knowledge/typage')

/** Un graphe des deux Brains : une relation d'équipe, et un pont perso → équipe. */
const graphe: GraphData = {
  nodes: [typecheck, lint, typage],
  links: [
    {
      source: 'knowledge/typecheck',
      target: 'knowledge/lint',
      weight: 0.5,
      relation: 'supersedes'
    },
    {
      source: 'perso:knowledge/typage',
      target: 'knowledge/typecheck',
      weight: 0.8,
      relation: 'pont'
    }
  ],
  ponts: { nombre: 1 }
}

describe('filtrerGrapheParAffichage', () => {
  it('« Les deux » ne retire rien : le même graphe revient', () => {
    expect(filtrerGrapheParAffichage(graphe, 'deux')).toBe(graphe)
  })

  it('« Équipe » retire les notes perso et le pont, qui en touche une', () => {
    const filtre = filtrerGrapheParAffichage(graphe, 'equipe')
    expect(filtre.nodes.map((node) => node.id)).toEqual(['knowledge/typecheck', 'knowledge/lint'])
    expect(filtre.links.map((lien) => lien.relation)).toEqual(['supersedes'])
  })

  it('« Perso » retire les notes d’équipe et les liens qui en touchent une', () => {
    const filtre = filtrerGrapheParAffichage(graphe, 'perso')
    expect(filtre.nodes.map((node) => node.id)).toEqual(['perso:knowledge/typage'])
    expect(filtre.links).toEqual([])
  })

  it('garde le lien entre deux notes perso quand on n’affiche que le perso', () => {
    const autre = perso('knowledge/velo')
    const deuxPerso: GraphData = {
      nodes: [typage, autre],
      links: [{ source: typage.id, target: autre.id, weight: 0.4 }]
    }
    expect(filtrerGrapheParAffichage(deuxPerso, 'perso').links).toHaveLength(1)
    expect(filtrerGrapheParAffichage(deuxPerso, 'equipe').links).toEqual([])
  })

  it('lit les extrémités données comme des nœuds, pas seulement comme des identifiants', () => {
    const avecObjets: GraphData = {
      nodes: [typecheck, lint, typage],
      links: [
        { source: typecheck, target: lint, weight: 0.5, relation: 'supersedes' },
        { source: typage, target: typecheck, weight: 0.8, relation: 'pont' }
      ]
    }
    expect(filtrerGrapheParAffichage(avecObjets, 'equipe').links.map((l) => l.relation)).toEqual([
      'supersedes'
    ])
    expect(filtrerGrapheParAffichage(avecObjets, 'perso').links).toEqual([])
  })

  it('ne modifie pas le graphe reçu', () => {
    const avant = JSON.stringify(graphe)
    filtrerGrapheParAffichage(graphe, 'equipe')
    filtrerGrapheParAffichage(graphe, 'perso')
    expect(JSON.stringify(graphe)).toBe(avant)
  })
})
