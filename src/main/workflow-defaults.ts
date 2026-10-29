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
 * Le `think` en tête recouvrait partiellement un chargement d'« empreinte du dépôt » câblé dans
 * chaque run. Ce chargement a été RETIRÉ le 2026-09-27 : sa question figée ramenait les mêmes notes
 * hors sujet. Le contexte de la tâche vient désormais de la liste de candidates injectée en tête de
 * run et de ce nœud, qui ouvre en entier ce qu'il juge nécessaire.
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
      'Un défaut à corriger : on charge le contexte, on reproduit, on répare, on nettoie, on fait juger, on capitalise. Le juge rouge renvoie au build, au plus deux fois.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('preuve')] },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('correcteur')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
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
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'frame-1', when: 'red', maxTraversals: 1 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'chantier-autowin',
    name: 'Chantier Autowin',
    description:
      'Une mission menée de bout en bout : charger le contexte, découvrir, cadrer, construire, nettoyer, faire juger et capitaliser. Un refus repart au build, toujours via clean.',
    graph: {
      entry: 'think-1',
      // Aucun agent imposé : chaque phase reprend le fournisseur, le modèle et le fan-out réglés
      // dans Agent Studio au moment du run.
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'scout-1', phase: 'scout' },
        { id: 'frame-1', phase: 'frame' },
        { id: 'build-1', phase: 'build' },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge' },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'scout-1', when: 'always' },
        { from: 'scout-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
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
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 3 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'exploration',
    name: 'Exploration',
    description:
      'On ne sait pas encore quoi faire. Cinq éclaireurs aux angles décorrélés, dont la veille externe, puis un cadrage, puis on garde la décision. Aucun build : le but est de décider.',
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
            agentStudio('rupture'),
            // Piste 6 de conv-890 : l'angle web du catalogue n'était lancé par aucun workflow livré.
            agentStudio('externe')
          ]
        },
        { id: 'frame-1', phase: 'frame', agents: [agentStudio('contraintes')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'scout-1', when: 'always' },
        { from: 'scout-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'learn-1', when: 'always' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'remake',
    name: 'Remake',
    description:
      'Le livrable est fini et marche : on paie les compromis accumulés. Le bar est le regret, pas le défaut. On nettoie avant de faire juger.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'remake-1', phase: 'remake' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('minimal')] },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('lean')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'remake-1', when: 'always' },
        { from: 'remake-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  /*
   * LES SEPT SUIVANTS VIENNENT DU CORPUS, pas d'une idée — conv-1094, 2026-10-22.
   *
   * 921 conversations relues (snapshot + archives), classées par la première demande humaine.
   * Chaque profil ci-dessous couvre une famille de demandes RÉCURRENTE qu'aucun des sept premiers
   * ne servait bien ; le compte entre parenthèses est le nombre de fils qui en contiennent une.
   *   kaizen (87) · retouche d'interface (337, dont 228 ouverts par elle) · retrait d'une fonction
   *   (72) · gel/lenteur (35) · audit en lecture seule (16) · code mort (4) · veille marché (4).
   * Écartés, et pourquoi : /draft (le choix se fait au clic dans le fil, un run ne peut pas
   * l'attendre) ; /git seul (il travaille sur l'arbre réel, un run sur une copie séparée) ;
   * les questions (réponse directe, aucun workflow) ; les lots de candidats d'un scout (couverts par
   * Chantier/Feature — leurs rouges venaient d'un fichier bloqué par un autre fil, pas du graphe).
   */
  {
    id: 'kaizen',
    name: 'Kaizen',
    description:
      'L’agent s’est mal comporté (il a rendu la main trop tôt, oublié une étape, menti sur un vert) : on retrace la conversation, on corrige le levier qui CAUSE le défaut, on fait juger la correction. Un refus renvoie au diagnostic, une fois.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'kaizen-1', phase: 'kaizen' },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('correcteur')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'kaizen-1', when: 'always' },
        { from: 'kaizen-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'kaizen-1', when: 'red', maxTraversals: 1 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'retouche-interface',
    name: 'Retouche d’interface',
    description:
      'Un petit réglage visible (bouton, badge, couleur, marge, popup qui déborde) : on corrige avec une preuve, puis un juge vérifie que c’est bien ce qui était demandé. Pas de cadrage ni de découverte. Un refus renvoie au build, au plus deux fois.',
    graph: {
      entry: 'build-1',
      nodes: [
        { id: 'build-1', phase: 'build', agents: [agentStudio('preuve')] },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('fidele')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'build-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'retrait',
    name: 'Retrait',
    description:
      'Enlever une fonction, une option ou un élément d’interface EN ENTIER : on le retire, on cherche ce qu’il laisse derrière lui (code mort, réglages, textes, tests), on nettoie, et un juge traque les restes. Un refus renvoie au build, au plus deux fois.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('minimal')] },
        { id: 'residus-1', phase: 'residus' },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('lean')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'residus-1', when: 'always' },
        { from: 'residus-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'gel',
    name: 'Gel',
    description:
      'Autowin a figé ou rame : on classe le journal des gels jusqu’au fichier et à la ligne coupables, on corrige avec un test rouge d’abord, on fait juger. Un refus renvoie au build, au plus deux fois.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'gel-1', phase: 'gel' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('preuve')] },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('correcteur')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'gel-1', when: 'always' },
        { from: 'gel-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'audit',
    name: 'Audit',
    description:
      'Juger un livrable qui EXISTE déjà, sans rien modifier : trois juges aux angles différents (justesse, sécurité, lisibilité), quorum de 2. Aucun build, aucun commit — le résultat est le verdict et ses preuves.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        {
          id: 'judge-1',
          phase: 'judge',
          quorum: 2,
          agents: [agentStudio('correcteur'), agentStudio('gardien'), agentStudio('naif')]
        }
      ],
      edges: [{ from: 'think-1', to: 'judge-1', when: 'always' }]
    }
  },
  {
    id: 'menage',
    name: 'Ménage du code',
    description:
      'Retirer le code mort : on balaie les fichiers, branches et scripts que plus rien n’atteint, on n’efface que ce qui est prouvé mort, on fait juger la sur-ingénierie restante. Un refus renvoie au build, au plus deux fois.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'residus-1', phase: 'residus' },
        { id: 'build-1', phase: 'build', agents: [agentStudio('minimal')] },
        { id: 'clean-1', phase: 'clean' },
        { id: 'judge-1', phase: 'judge', agents: [agentStudio('lean')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'residus-1', when: 'always' },
        { from: 'residus-1', to: 'build-1', when: 'always' },
        { from: 'build-1', to: 'clean-1', when: 'always' },
        { from: 'clean-1', to: 'judge-1', when: 'always' },
        { from: 'judge-1', to: 'build-1', when: 'red', maxTraversals: 2 },
        { from: 'judge-1', to: 'learn-1', when: 'green' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  },
  {
    id: 'veille-marche',
    name: 'Veille marché',
    description:
      'Recenser tous les acteurs qui vendent un produit (startups, éditeurs, open source), prendre le meilleur de chacun, puis cadrer ce qu’on en reprend. Aucun build : le but est de décider quoi voler.',
    graph: {
      entry: 'think-1',
      nodes: [
        { id: 'think-1', phase: 'think' },
        { id: 'steal-1', phase: 'steal' },
        { id: 'frame-1', phase: 'frame', agents: [agentStudio('probleme')] },
        { id: 'learn-1', phase: 'learn' },
        { id: 'git-1', phase: 'git' }
      ],
      edges: [
        { from: 'think-1', to: 'steal-1', when: 'always' },
        { from: 'steal-1', to: 'frame-1', when: 'always' },
        { from: 'frame-1', to: 'learn-1', when: 'always' },
        { from: 'learn-1', to: 'git-1', when: 'always' }
      ]
    }
  }
]
