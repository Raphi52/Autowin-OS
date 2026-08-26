import { describe, expect, it } from 'vitest'
import { nodeRanks } from './workflow-graph'
import { estJugeTerminal, noeudApprentissageApresJuge } from './workflow-walk'
import type { WorkflowGraph } from './workflow-graph'

/**
 * UN JUGE RESTE TERMINAL MALGRÉ UNE ARÊTE VERS `learn` — et voici pourquoi cette exception est
 * légitime au lieu d'être une entorse.
 *
 * LE CONTEXTE MESURÉ, deux défauts qui encadrent ce point :
 *
 *  - `conv-1071` : un juge joué par le marcheur PUIS par le gate final produisait deux appels
 *    identiques, dont le premier portait en plus le sandbox d'une phase de mutation. D'où la règle
 *    « le marcheur s'arrête AVANT un juge terminal », car le juge terminal EST le gate final.
 *  - `workflow-walk.recovery-budget` : quand le juge n'est pas reconnu terminal, le marcheur consomme
 *    le budget de retour que la boucle de réparation relit ensuite. Mesuré le 2026-08-25 en posant
 *    l'arête `judge → learn` : `correctif` passe à 3 passages build là où le profil en annonce 1,
 *    `panel-critique` à 4.
 *
 * LA RAISON DE L'EXCEPTION : `learn` n'est PAS joué par la marche. Il est joué après le gate, une
 * fois le verdict rendu — capitaliser suppose un travail validé. Une arête vers lui n'appartient donc
 * pas au canevas que le marcheur parcourt, et la compter comme « arête qui avance » ferait
 * exactement l'un des deux défauts ci-dessus.
 *
 * LA BORNE : l'exception ne vaut que pour un nœud `learn` TERMINAL. Un `learn` qui aurait une sortie
 * serait une vraie continuation, et le juge cesserait à juste titre d'être terminal — sinon on
 * rouvrirait le contre-exemple que ce module documente (« un juge qui CONTINUE vers b » abandonné en
 * silence).
 */

const rangs = (graph: WorkflowGraph): Map<string, number> => nodeRanks(graph)

const avecLearn: WorkflowGraph = {
  entry: 'build-1',
  nodes: [
    { id: 'build-1', phase: 'build' },
    { id: 'judge-1', phase: 'judge' },
    { id: 'learn-1', phase: 'learn' }
  ],
  edges: [
    { from: 'build-1', to: 'judge-1', when: 'always' },
    { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
    { from: 'judge-1', to: 'learn-1', when: 'green' }
  ]
}

describe('un juge reste terminal quand sa seule sortie avant mène à `learn`', () => {
  it('le juge est TERMINAL — le marcheur s’arrête avant lui, le gate le joue une fois', () => {
    expect(estJugeTerminal(avecLearn, 'judge-1', rangs(avecLearn))).toBe(true)
  })

  it('le nœud d’apprentissage est DÉSIGNÉ, pour être joué après le gate', () => {
    expect(noeudApprentissageApresJuge(avecLearn)).toBe('learn-1')
  })

  it('sans arête déclarée, aucun nœud n’est désigné — la capitalisation reste opt-in par profil', () => {
    const sansLearn: WorkflowGraph = {
      entry: 'build-1',
      nodes: [
        { id: 'build-1', phase: 'build' },
        { id: 'judge-1', phase: 'judge' }
      ],
      edges: [{ from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }]
    }

    expect(noeudApprentissageApresJuge(sansLearn)).toBeUndefined()
  })
})

describe('la borne de l’exception', () => {
  it('un `learn` qui CONTINUE rend le juge non terminal — le contre-exemple reste protégé', () => {
    // Si `learn` a une sortie, ce n'est plus une capitalisation terminale mais une étape du canevas.
    // Le juge doit alors redevenir non terminal, sinon le marcheur abandonnerait la suite EN SILENCE.
    const learnQuiContinue: WorkflowGraph = {
      ...avecLearn,
      nodes: [...avecLearn.nodes, { id: 'build-2', phase: 'build' }],
      edges: [...avecLearn.edges, { from: 'learn-1', to: 'build-2', when: 'always' }]
    }

    expect(estJugeTerminal(learnQuiContinue, 'judge-1', rangs(learnQuiContinue))).toBe(false)
    expect(noeudApprentissageApresJuge(learnQuiContinue)).toBeUndefined()
  })

  it('une arête verte vers autre chose qu’un `learn` rend le juge non terminal', () => {
    // L'exception est nominative : elle ne s'étend pas à n'importe quelle continuation verte.
    const versUnBuild: WorkflowGraph = {
      entry: 'build-1',
      nodes: [
        { id: 'build-1', phase: 'build' },
        { id: 'judge-1', phase: 'judge' },
        { id: 'build-2', phase: 'build' }
      ],
      edges: [
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-2', when: 'green' }
      ]
    }

    expect(estJugeTerminal(versUnBuild, 'judge-1', rangs(versUnBuild))).toBe(false)
  })

  it('une arête vers `learn` conditionnée ROUGE ne désigne rien — on ne capitalise pas un refus', () => {
    const surRouge: WorkflowGraph = {
      ...avecLearn,
      edges: [
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'learn-1', when: 'red' }
      ]
    }

    expect(noeudApprentissageApresJuge(surRouge)).toBeUndefined()
  })
})
