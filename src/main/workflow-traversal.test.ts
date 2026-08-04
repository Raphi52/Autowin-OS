import { describe, expect, it } from 'vitest'
import {
  emptyTraversal,
  nextStep,
  openPassage,
  recordPassage,
  replayPath,
  type TraversalState
} from './workflow-traversal'
import type { WorkflowGraph } from './workflow-graph'

/** frame → build → judge, le juge rouge renvoyant au build au plus deux fois. */
const graphe: WorkflowGraph = {
  entry: 'f',
  nodes: [
    { id: 'f', phase: 'frame' },
    { id: 'b', phase: 'build' },
    { id: 'j', phase: 'judge' }
  ],
  edges: [
    { from: 'f', to: 'b', when: 'always' },
    { from: 'b', to: 'j', when: 'always' },
    { from: 'j', to: 'b', when: 'red', maxTraversals: 2 }
  ]
}

/** Joue le graphe en donnant les verdicts d'avance ; rend le chemin et la raison de l'arrêt. */
function derouler(verdicts: ('green' | 'red')[]): { chemin: string[]; raison: string } {
  let state: TraversalState = emptyTraversal()
  const chemin: string[] = []
  for (let garde = 0; garde < 40; garde++) {
    const pas = nextStep(graphe, state)
    if (pas.kind === 'done') return { chemin, raison: pas.reason }
    chemin.push(`${pas.node.id}#${pas.occurrence}`)
    const verdict = verdicts[chemin.length - 1] ?? 'green'
    state = recordPassage(graphe, state, pas.node.id, pas.occurrence, verdict)
  }
  throw new Error('le parcours ne termine pas — la borne ne tient pas')
}

describe('parcourir un graphe', () => {
  it('tout vert : chaque nœud une fois, dans l’ordre', () => {
    expect(derouler(['green', 'green', 'green'])).toEqual({
      chemin: ['f#1', 'b#1', 'j#1'],
      raison: 'fin-de-graphe'
    })
  })

  it('un juge rouge renvoie au build — le cas que la liste linéaire ne savait pas dire', () => {
    const { chemin } = derouler(['green', 'green', 'red', 'green', 'green'])
    expect(chemin).toEqual(['f#1', 'b#1', 'j#1', 'b#2', 'j#2'])
  })

  it('le retour numérote les passages : deux visites du même nœud ne se confondent pas', () => {
    const { chemin } = derouler(['green', 'green', 'red', 'green', 'green'])
    expect(chemin.filter((p) => p.startsWith('b'))).toEqual(['b#1', 'b#2'])
  })

  it('la borne ARRÊTE la boucle, et le dit', () => {
    // Sans elle, ce test ne terminerait pas — c'est précisément ce qu'on vérifie.
    const { chemin, raison } = derouler(['green', 'green', 'red', 'green', 'red', 'green', 'red'])
    expect(chemin).toEqual(['f#1', 'b#1', 'j#1', 'b#2', 'j#2', 'b#3', 'j#3'])
    expect(raison).toBe('limites-atteintes')
  })

  it('« limites atteintes » se distingue de « fin de graphe »', () => {
    // Pour l'utilisateur ce n'est pas le même résultat : l'un a fini, l'autre a abandonné.
    expect(derouler(['green', 'green', 'green']).raison).toBe('fin-de-graphe')
  })

  it('une arête rouge ne se franchit pas sur un verdict vert', () => {
    expect(derouler(['green', 'green', 'green']).chemin).not.toContain('b#2')
  })

  it('un graphe dont l’entrée n’existe pas s’arrête au lieu de planter', () => {
    expect(nextStep({ ...graphe, entry: 'nulle-part' }, emptyTraversal())).toEqual({
      kind: 'done',
      reason: 'fin-de-graphe'
    })
  })
})

describe('reprise après crash', () => {
  it('un passage OUVERT mais non résolu se rejoue — l’app est morte pendant ce nœud', () => {
    let state = emptyTraversal()
    state = recordPassage(graphe, state, 'f', 1, 'green')
    state = openPassage(state, 'b', 1) // crash ici : aucun verdict enregistré
    const pas = nextStep(graphe, state)
    expect(pas).toMatchObject({ kind: 'run', node: { id: 'b' }, occurrence: 1 })
  })

  it('la reprise vise le bon PASSAGE, pas la bonne phase', () => {
    // C'est là qu'un index par phase serait ambigu : le build a déjà tourné une fois.
    let state = emptyTraversal()
    for (const [id, verdict] of [
      ['f', 'green'],
      ['b', 'green'],
      ['j', 'red']
    ] as const) {
      const pas = nextStep(graphe, state)
      if (pas.kind !== 'run') throw new Error('parcours inattendu')
      expect(pas.node.id).toBe(id)
      state = recordPassage(graphe, state, pas.node.id, pas.occurrence, verdict)
    }
    state = openPassage(state, 'b', 2)
    expect(nextStep(graphe, state)).toMatchObject({ occurrence: 2 })
  })

  it('reprendre ne reconsomme pas la borne déjà payée', () => {
    let state = emptyTraversal()
    state = recordPassage(graphe, state, 'f', 1, 'green')
    state = recordPassage(graphe, state, 'b', 1, 'green')
    state = recordPassage(graphe, state, 'j', 1, 'red')
    state = recordPassage(graphe, state, 'b', 2, 'green')
    const consomme = Object.values(state.traversals)[0]
    // Réenregistrer le même passage ne doit pas compter un franchissement de plus.
    const rejoue = recordPassage(graphe, state, 'b', 2, 'green')
    expect(Object.values(rejoue.traversals)[0]).toBe(consomme)
  })
})

describe('rejeu à l’identique', () => {
  it('la trace rend le chemin réellement parcouru, verdicts compris', () => {
    let state = emptyTraversal()
    state = recordPassage(graphe, state, 'f', 1, 'green')
    state = recordPassage(graphe, state, 'b', 1, 'red')
    expect(replayPath(state)).toEqual([
      { nodeId: 'f', occurrence: 1, outcome: 'green' },
      { nodeId: 'b', occurrence: 1, outcome: 'red' }
    ])
  })

  it('un passage resté ouvert n’entre pas dans le rejeu — il n’a pas eu lieu', () => {
    let state = recordPassage(graphe, emptyTraversal(), 'f', 1, 'green')
    state = openPassage(state, 'b', 1)
    expect(replayPath(state)).toHaveLength(1)
  })
})
