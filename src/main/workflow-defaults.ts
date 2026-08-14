import type { WorkflowProfile } from './workflow-profiles'

/**
 * Les workflows livrés d'origine.
 *
 * Une vue vide ne s'utilise pas : composer un graphe depuis une page blanche demande de connaître
 * les phases, les personas, les bornes de retour — c'est-à-dire tout ce que ces exemples montrent.
 * Ils servent de POINT DE DÉPART à dupliquer, pas de dogme : chacun est modifiable et supprimable.
 *
 * Ils sont posés UNE SEULE FOIS, quand le fichier de profils n'existe pas encore. Les réimposer à
 * chaque démarrage ferait revenir ce que l'utilisateur a délibérément supprimé.
 */

const agentStudio = (persona?: string): { persona?: string } => ({
  ...(persona ? { persona } : {})
})

export const DEFAULT_WORKFLOWS: WorkflowProfile[] = [
  {
    id: 'eclair',
    name: 'Éclair',
    description: 'Une question, une réponse. Aucun cérémonial — pour ce qui ne mérite pas un pipeline.',
    graph: {
      entry: 'build-1',
      nodes: [{ id: 'build-1', phase: 'build' }],
      edges: []
    }
  },
  {
    id: 'correctif',
    name: 'Correctif',
    description:
      'Un défaut à corriger : on reproduit, on répare, on fait juger. Le juge rouge renvoie au build, au plus deux fois.',
    graph: {
      entry: 'build-1',
      nodes: [
        { id: 'build-1', phase: 'build', agents: [agentStudio('preuve')] },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('correcteur')] }
      ],
      edges: [
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
      ]
    }
  },
  {
    id: 'feature',
    name: 'Feature',
    description:
      'Un besoin à cadrer puis à construire. Le juge rejette vers le build ; un cadrage invalidé remonte au frame.',
    graph: {
      entry: 'frame-1',
      nodes: [
        { id: 'frame-1', phase: 'frame', agents: [agentStudio('probleme')] },
        { id: 'build-1', phase: 'build', agents: [agentStudio('minimal')] },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('fidele')] }
      ],
      edges: [
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'frame-1', when: 'red', maxTraversals: 1 }
      ]
    }
  },
  {
    id: 'chantier-autowin',
    name: 'Chantier Autowin',
    description:
      'Une mission menée de bout en bout : découvrir, cadrer, préparer le terrain, construire, nettoyer et faire juger. Un refus repart au build, toujours via clean.',
    graph: {
      entry: 'scout-1',
      // Aucun agent imposé : chaque phase reprend le fournisseur, le modèle et le fan-out réglés
      // dans Agent Studio au moment du run.
      nodes: [
        { id: 'scout-1', phase: 'scout' },
        { id: 'frame-1', phase: 'frame' },
        { id: 'terrain-1', phase: 'terrain' },
        { id: 'build-1', phase: 'build' },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge' }
      ],
      edges: [
        { from: 'scout-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'terrain-1', when: 'always' },
        { from: 'terrain-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
      ]
    }
  },
  {
    id: 'panel-critique',
    name: 'Panel critique',
    description:
      'Pour ce qui coûte cher d’être faux : trois juges aux angles DIFFÉRENTS, quorum de 2. Trois juges identiques ne valent pas mieux qu’un seul.',
    graph: {
      entry: 'build-1',
      nodes: [
        { id: 'build-1', phase: 'build' },
        {
          id: 'judge-1',
          phase: 'judge',
          quorum: 2,
          agents: [
            agentStudio('correcteur'),
            agentStudio('gardien'),
            agentStudio('lean')
          ]
        }
      ],
      edges: [
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 3 }
      ]
    }
  },
  {
    id: 'exploration',
    name: 'Exploration',
    description:
      'On ne sait pas encore quoi faire. Quatre éclaireurs aux angles décorrélés, puis un cadrage. Aucun build : le but est de décider.',
    graph: {
      entry: 'scout-1',
      nodes: [
        {
          id: 'scout-1',
          phase: 'scout',
          agents: [
            agentStudio('dette'),
            agentStudio('fragilite'),
            agentStudio('usage'),
            agentStudio('rupture')
          ]
        },
        { id: 'frame-1', phase: 'frame', agents: [agentStudio('contraintes')] }
      ],
      edges: [{ from: 'scout-1', to: 'frame-1', when: 'always' }]
    }
  },
  {
    id: 'remake',
    name: 'Remake',
    description:
      'Le livrable est fini et marche : on paie les compromis accumulés. Le bar est le regret, pas le défaut.',
    graph: {
      entry: 'remake-1',
      nodes: [
        { id: 'remake-1', phase: 'remake' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('minimal')] },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('lean')] }
      ],
      edges: [
        { from: 'remake-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 }
      ]
    }
  }
]
