import { describe, expect, it } from 'vitest'
import {
  graphDefects,
  graphFromPhases,
  linearPhasesOf,
  worstCaseNodeExecutions,
  agentsForPhase,
  allocationFromGraph,
  quorumForPhase,
  worstCaseVisits,
  type WorkflowGraph
} from './workflow-graph'

/** frame → build → judge, avec un retour judge → build quand le juge rejette. */
const avecBoucle = (maxTraversals?: number): WorkflowGraph => ({
  entry: 'f',
  nodes: [
    { id: 'f', phase: 'frame' },
    { id: 'b', phase: 'build' },
    { id: 'j', phase: 'judge' }
  ],
  edges: [
    { from: 'f', to: 'b', when: 'always' },
    { from: 'b', to: 'j', when: 'always' },
    { from: 'j', to: 'b', when: 'red', ...(maxTraversals !== undefined ? { maxTraversals } : {}) }
  ]
})

const chaine: WorkflowGraph = {
  entry: 'f',
  nodes: [
    { id: 'f', phase: 'frame' },
    { id: 'b', phase: 'build' }
  ],
  edges: [{ from: 'f', to: 'b', when: 'always' }]
}

describe('ce qui empêche un graphe de tourner', () => {
  it('une chaîne simple n’a aucun défaut', () => {
    expect(graphDefects(chaine)).toEqual([])
  })

  it('un retour SANS limite est refusé — c’est la règle qui garde le run fini', () => {
    const defauts = graphDefects(avecBoucle())
    expect(defauts).toHaveLength(1)
    expect(defauts[0].message).toContain('jamais s’arrêter')
    expect(defauts[0].target).toBe('j') // le canevas doit pouvoir surligner l'arête fautive
  })

  it('un retour borné passe', () => {
    expect(graphDefects(avecBoucle(2))).toEqual([])
  })

  it('une limite absurde est refusée', () => {
    expect(graphDefects(avecBoucle(0))[0].message).toContain('entre 1 et')
    expect(graphDefects(avecBoucle(999))[0].message).toContain('entre 1 et')
  })

  it('une boucle sur soi-même est un retour, donc à borner', () => {
    const soi: WorkflowGraph = {
      entry: 'b',
      nodes: [{ id: 'b', phase: 'build' }],
      edges: [{ from: 'b', to: 'b', when: 'red' }]
    }
    expect(graphDefects(soi)[0].message).toContain('jamais s’arrêter')
  })

  it('signale TOUS les défauts d’un coup, pas le premier', () => {
    // Un canevas qui ne montre qu'une erreur à la fois fait corriger en aveugle.
    const bancal: WorkflowGraph = {
      entry: 'f',
      nodes: [
        { id: 'f', phase: 'frame' },
        { id: 'f', phase: 'build' },
        { id: 'orphelin', phase: 'clean' }
      ],
      edges: [{ from: 'f', to: 'inconnu', when: 'always' }]
    }
    const messages = graphDefects(bancal)
      .map((d) => d.message)
      .join(' | ')
    expect(messages).toContain('portent l’id')
    expect(messages).toContain('nœud inconnu')
    expect(messages).toContain('jamais atteint')
  })

  it('un quorum plus grand que le nombre d’agents est impossible', () => {
    const trop: WorkflowGraph = {
      entry: 'j',
      nodes: [
        { id: 'j', phase: 'judge', agents: [{ provider: 'claude' }, { provider: 'codex' }], quorum: 3 }
      ],
      edges: []
    }
    expect(graphDefects(trop)[0].message).toContain('Quorum 3 impossible')
  })

  it('un point d’entrée fantôme est dit tout de suite', () => {
    expect(graphDefects({ ...chaine, entry: 'nulle-part' })[0].message).toContain('point d’entrée')
  })

  it('un graphe vide est un défaut, pas un graphe valide', () => {
    expect(graphDefects({ entry: '', nodes: [], edges: [] })[0].message).toContain('vide')
  })
})

describe('provisionner le pire cas', () => {
  it('sans boucle, une visite par nœud', () => {
    expect(worstCaseNodeExecutions(chaine)).toBe(2)
  })

  it('une boucle bornée à N rejoue au plus N fois ce qui est réatteignable', () => {
    // C'est ce nombre — pas `phases.length` — que le devis doit provisionner.
    const visites = worstCaseVisits(avecBoucle(2))
    expect(visites.get('b')).toBe(3) // 1 passage + 2 retours
    expect(visites.get('j')).toBe(3)
    expect(visites.get('f')).toBe(1) // hors de la boucle : jamais rejoué
    expect(worstCaseNodeExecutions(avecBoucle(2))).toBe(7)
  })

  it('deux boucles imbriquées se MULTIPLIENT, elles ne s’additionnent pas', () => {
    // Sous-provisionner ici, c'est un run coupé en plein milieu au lieu d'être refusé proprement.
    const imbrique: WorkflowGraph = {
      entry: 'f',
      nodes: [
        { id: 'f', phase: 'frame' },
        { id: 'b', phase: 'build' },
        { id: 'j', phase: 'judge' }
      ],
      edges: [
        { from: 'f', to: 'b', when: 'always' },
        { from: 'b', to: 'j', when: 'always' },
        { from: 'j', to: 'b', when: 'red', maxTraversals: 1 },
        { from: 'j', to: 'f', when: 'red', maxTraversals: 1 }
      ]
    }
    // Le retour vers f rejoue TOUT, y compris la boucle interne : 2 × 2 = 4, pas 1 + 1 + 1.
    expect(worstCaseVisits(imbrique).get('b')).toBe(4)
  })

  it('le pire cas est FINI dès que les retours sont bornés', () => {
    expect(Number.isFinite(worstCaseNodeExecutions(avecBoucle(3)))).toBe(true)
  })
})

describe('compatibilité avec les workflows déjà enregistrés', () => {
  it('une liste de phases devient une chaîne équivalente', () => {
    const graphe = graphFromPhases(['frame', 'build'])
    expect(graphe.nodes.map((n) => n.phase)).toEqual(['frame', 'build'])
    expect(graphe.edges).toHaveLength(1)
    expect(graphDefects(graphe)).toEqual([])
  })

  it('et se relit comme la même liste — la conversion ne perd rien', () => {
    expect(linearPhasesOf(graphFromPhases(['scout', 'frame', 'build']))).toEqual([
      'scout',
      'frame',
      'build'
    ])
  })

  it('deux phases identiques restent deux nœuds distincts', () => {
    const graphe = graphFromPhases(['build', 'build'])
    expect(new Set(graphe.nodes.map((n) => n.id)).size).toBe(2)
  })

  it('un graphe AVEC boucle n’a pas de suite linéaire — le moteur actuel ne peut pas le jouer', () => {
    expect(linearPhasesOf(avecBoucle(2))).toBeUndefined()
  })

  it('un embranchement non plus', () => {
    const fourche: WorkflowGraph = {
      entry: 'f',
      nodes: [
        { id: 'f', phase: 'frame' },
        { id: 'b', phase: 'build' },
        { id: 'c', phase: 'clean' }
      ],
      edges: [
        { from: 'f', to: 'b', when: 'green' },
        { from: 'f', to: 'c', when: 'red' }
      ]
    }
    expect(linearPhasesOf(fourche)).toBeUndefined()
  })
})

describe('les agents composés sur un nœud', () => {
  const avecAgents: WorkflowGraph = {
    entry: 'b',
    nodes: [
      { id: 'b', phase: 'build', agents: [{ provider: 'claude', model: 'gros' }] },
      {
        id: 'j',
        phase: 'judge',
        agents: [{ provider: 'claude' }, { provider: 'codex' }, { provider: 'gemini' }],
        quorum: 2
      }
    ],
    edges: [{ from: 'b', to: 'j', when: 'always' }]
  }

  it('se lisent par phase', () => {
    expect(agentsForPhase(avecAgents, 'judge')).toHaveLength(3)
    expect(agentsForPhase(avecAgents, 'build')).toEqual([{ provider: 'claude', model: 'gros' }])
    expect(agentsForPhase(avecAgents, 'clean')).toBeUndefined()
  })

  it('un agent sans provider n’est pas exécutable, donc pas compté', () => {
    const bancal: WorkflowGraph = {
      entry: 'j',
      nodes: [{ id: 'j', phase: 'judge', agents: [{ provider: 'claude' }, {} as never] }],
      edges: []
    }
    expect(agentsForPhase(bancal, 'judge')).toHaveLength(1)
  })

  it('le quorum se lit par phase, absent = majorité simple', () => {
    expect(quorumForPhase(avecAgents, 'judge')).toBe(2)
    expect(quorumForPhase(avecAgents, 'build')).toBeUndefined()
  })

  it('l’allocation DÉCOULE des agents composés — sinon le panel serait tronqué', () => {
    // Trois juges composés mais une allocation à 1 : on en jouerait un seul, en silence.
    const alloc = allocationFromGraph(avecAgents)
    expect(alloc.judgeMembers).toBe(3)
    expect(alloc.phaseMembers).toEqual({ build: 1 })
  })

  it('un graphe sans agent composé n’impose aucune allocation', () => {
    expect(allocationFromGraph(chaine)).toEqual({})
  })
})
