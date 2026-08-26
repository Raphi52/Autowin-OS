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
 *
 * `think` EN TÊTE, `learn` EN QUEUE — ajoutés le 2026-08-25, et voici pourquoi ils manquaient.
 *
 * Les deux skills sont sur disque et chargent de vraies instructions (7492 et 6189 caractères
 * mesurés), et `skill-node-tools.ts` a été écrit EXPLICITEMENT pour elles — son en-tête dit qu'« un
 * nœud portant `think` ou `learn` recevait ses instructions […] sans disposer d'aucun de ces outils »
 * — pour leur servir `brain_query` et `remember`. Pourtant AUCUN des sept profils ne les employait :
 * une brique écrite, outillée, et jamais posée. `learn` ne tournait donc que par le superviseur
 * d'issues, jamais comme étape choisie.
 *
 * `learn` peut ÉCRIRE malgré un nœud en lecture seule : `sandboxForPhase` réserve
 * `danger-full-access` à `build` et `clean`, donc un nœud skill ne touche ni fichier ni build — mais
 * « lecture seule » qualifie le DÉPÔT, pas le Brain. Déposer un fait via `remember` est un acte
 * d'une autre nature, réversible et mis en revue par le Brain lui-même.
 *
 * `eclair` EST DÉLIBÉRÉMENT ÉPARGNÉ : sa promesse est « aucun cérémonial — pour ce qui ne mérite pas
 * un pipeline ». Lui ajouter deux nœuds contredirait la seule chose qu'il dit faire. Le coût est réel
 * et assumé ailleurs : deux appels fournisseur de plus par run, pour du travail substantiel.
 *
 * Le `think` en tête RECOUVRE PARTIELLEMENT le chargement d'empreinte déjà câblé dans chaque run
 * (`orchestrator.ts`, rôle `think`). Ce n'est pas un doublon : le câblage récupère l'empreinte
 * DURABLE du dépôt, la skill va chercher le contexte de LA TÂCHE — mémoire, code, décisions passées.
 * Le recouvrement est nommé ici plutôt que découvert plus tard.
 */

const agentStudio = (persona?: string): { persona?: string } => ({
  ...(persona ? { persona } : {})
})

export const DEFAULT_WORKFLOWS: WorkflowProfile[] = [
  {
    id: 'eclair',
    name: 'Éclair',
    description:
      'Une question, une réponse. Aucun cérémonial — pour ce qui ne mérite pas un pipeline.',
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
      'Un défaut à corriger : on charge le contexte, on reproduit, on répare, on fait juger, on capitalise. Le juge rouge renvoie au build, au plus deux fois.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('preuve')] },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('correcteur')] },
        { id: 'learn-1', phase: 'learn' }
      ],
      edges: [
        { from: 'think-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' }
      ]
    }
  },
  {
    id: 'feature',
    name: 'Feature',
    description:
      'Un besoin à cadrer puis à construire, contexte chargé d’abord et leçon gardée à la fin. Le juge rejette vers le build ; un cadrage invalidé remonte au frame.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'frame-1', phase: 'frame', agents: [agentStudio('probleme')] },
        { id: 'build-1', phase: 'build', agents: [agentStudio('minimal')] },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('fidele')] },
        { id: 'learn-1', phase: 'learn' }
      ],
      edges: [
        { from: 'think-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'frame-1', when: 'red', maxTraversals: 1 },
        { from: 'judge-1', to: 'learn-1', when: 'green' }
      ]
    }
  },
  {
    id: 'chantier-autowin',
    name: 'Chantier Autowin',
    description:
      'Une mission menée de bout en bout : charger le contexte, découvrir, cadrer, préparer le terrain, construire, nettoyer, faire juger et capitaliser. Un refus repart au build, toujours via clean.',
    graph: {
      entry: 'think-1',
      // Aucun agent imposé : chaque phase reprend le fournisseur, le modèle et le fan-out réglés
      // dans Agent Studio au moment du run.
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'scout-1', phase: 'scout' },
        { id: 'frame-1', phase: 'frame' },
        { id: 'terrain-1', phase: 'terrain' },
        { id: 'build-1', phase: 'build' },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge' },
        { id: 'learn-1', phase: 'learn' }
      ],
      edges: [
        { from: 'think-1', to: 'scout-1', when: 'always' },
        { from: 'scout-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'terrain-1', when: 'always' },
        { from: 'terrain-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' }
      ]
    }
  },
  {
    id: 'panel-critique',
    name: 'Panel critique',
    description:
      'Pour ce qui coûte cher d’être faux : trois juges aux angles DIFFÉRENTS, quorum de 2. Trois juges identiques ne valent pas mieux qu’un seul.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'build-1', phase: 'build' },
        {
          id: 'judge-1',
          phase: 'judge',
          quorum: 2,
          agents: [agentStudio('correcteur'), agentStudio('gardien'), agentStudio('lean')]
        },
        { id: 'learn-1', phase: 'learn' }
      ],
      edges: [
        { from: 'think-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 3 },
        { from: 'judge-1', to: 'learn-1', when: 'green' }
      ]
    }
  },
  {
    id: 'exploration',
    name: 'Exploration',
    description:
      'On ne sait pas encore quoi faire. Quatre éclaireurs aux angles décorrélés, puis un cadrage, puis on garde la décision. Aucun build : le but est de décider.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
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
        { id: 'frame-1', phase: 'frame', agents: [agentStudio('contraintes')] },
        { id: 'learn-1', phase: 'learn' }
      ],
      edges: [
        { from: 'think-1', to: 'scout-1', when: 'always' },
        { from: 'scout-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'learn-1', when: 'always' }
      ]
    }
  },
  {
    id: 'remake',
    name: 'Remake',
    description:
      'Le livrable est fini et marche : on paie les compromis accumulés. Le bar est le regret, pas le défaut.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'remake-1', phase: 'remake' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('minimal')] },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('lean')] },
        { id: 'learn-1', phase: 'learn' }
      ],
      edges: [
        { from: 'think-1', to: 'remake-1', when: 'always' },
        { from: 'remake-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' }
      ]
    }
  }
]
