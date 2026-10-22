export type RunWorkspaceMode = 'base' | 'worktree'
export type RunGitOutcome = 'merged' | 'nothing' | 'conflict' | 'blocked' | 'kept'
export type RunClosureStatus = 'open' | 'green' | 'degraded-closed' | 'red'

/**
 * Le statut ÉCRIT dans un RUN.md. Il ajoute `interrupted` à ceux du moteur : un run coupé de
 * l'extérieur (bouton Stop, limite de session, panne du fournisseur) n'a ni échoué ni abouti, il
 * s'est arrêté (piste 4, conv-1070). Le moteur, lui, garde `red` — le run n'a rien livré — et nomme
 * la cause dans `RunClosureObservation.interruption` ; `statutDuRunMd` fait la traduction.
 */
export type RunFileStatus = RunClosureStatus | 'interrupted'

/** Cause d'un arrêt étrangère au travail (`causeDInterruption`, `classe-terminale-echec.ts`). */
export type RunInterruption = 'arret' | 'quota' | 'externe'

/**
 * D'où vient le workflow qui pilote le run. Le NOM seul ne suffit pas : un workflow que
 * l'utilisateur n'a jamais demandé — choisi par le modèle, voire composé par lui à la volée —
 * n'engage pas la même confiance qu'un workflow choisi à la main. C'est justement le cas où
 * l'utilisateur n'a rien décidé qui mérite d'être signalé.
 */
export type RunWorkflowSource = 'manuel' | 'modele' | 'compose'

export interface RunWorkflowObservation {
  name: string
  source: RunWorkflowSource
}

export interface RunExecutionQuoteObservation {
  quoteId: string
  /**
   * La façon de travailler qui pilote ce run. ABSENT = aucun workflow, ce qui est une réponse de
   * plein droit et non une donnée manquante — l'affichage doit le dire, pas masquer la ligne.
   *
   * Optionnel pour rester relisible : un événement `quote` émis avant ce champ reste valide.
   */
  workflow?: RunWorkflowObservation
  regime: 'trivial' | 'standard' | 'critical'
  phases: string[]
  decomposition: { mode: 'disabled' | 'build-only'; maxNodes: number }
  limits: {
    maxProviderCalls: number
    maxFreshTokens: number
    maxTotalTokens: number
    maxAgents: number
    maxConcurrency: number
    maxDurationMs: number
    maxRecoveries: number
    maxUsd: number | null
  }
  allocation?: {
    phaseMembers: Partial<Record<string, number>>
    judgeMembers: number
    maxGreedyNodes: number
    reservedMandatoryAgents: number
    plannedMaxAgents: number
    plannedMaxCalls: number
  }
}

export interface RunWorkspaceObservation {
  mode: RunWorkspaceMode
  /** Dépôt de travail qui porte le tronc commun de la conversation. */
  repositoryPath: string
  /** Chemin effectivement donné aux agents : copie isolée ou dépôt de travail. */
  path: string
  baseBranch?: string
  baseSha?: string
}

export interface RunGitObservation {
  /** Sort produit pour l'interface ; `rawOutcome` conserve la valeur exacte du moteur. */
  outcome: RunGitOutcome
  rawOutcome?: string
  commitSha?: string
  baseBranch?: string
  worktreePath?: string
  files?: string[]
  reason?: string
  detail?: string
}

export interface RunClosureObservation {
  status: RunClosureStatus
  totalDurationMs: number
  totalCostUsd: number
  gateReasons?: string[]
  /**
   * PRÉSENT seulement sur une clôture `red` dont la cause est hors du travail : `arret` (Stop,
   * fermeture de l'app), `quota` (limite de session), `externe` (panne en face, session expirée).
   * ABSENT = un vrai échec, ou une trace écrite avant ce champ (piste 4, conv-1070).
   */
  interruption?: RunInterruption
  integrationOutcome?: string
  /**
   * Chemin du RUN.md de ce run. Le moteur ne le connaît pas : c'est l'appelant qui a créé le RUN.md
   * (`commands.ts`, reprise au démarrage) qui le pose au moment d'écrire la trace. Sans lui, le bilan
   * du nœud « Clôture du run » ne pouvait relier le run à aucun fichier : rien d'autre dans la
   * trace ne fait le lien entre `run-<hash>` et `runs/<conv>/<sujet>-workspace/RUN.md`.
   * ABSENT sur les runs écrits avant ce champ, ou lancés sans RUN.md.
   */
  runPath?: string
  usage?: {
    startedAgents?: number
    startedCalls: number
    completedCalls: number
    failedCalls: number
    activeCalls: number
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    totalTokens: number
    freshTokens: number
    knownCostUsd: number | null
    unpricedCalls: number
    unmeteredCalls: number
    tokenCoverage: 'complete' | 'partial'
    stoppedReason?: string
  }
}

export type RunLifecycleEvent =
  | {
      stage: 'quote'
      runId: string
      timestampMs: number
      quote: RunExecutionQuoteObservation
    }
  | {
      stage: 'workspace'
      runId: string
      timestampMs: number
      workspace: RunWorkspaceObservation
    }
  | {
      stage: 'git'
      runId: string
      timestampMs: number
      git: RunGitObservation
    }
  | {
      stage: 'closure'
      runId: string
      timestampMs: number
      closure: RunClosureObservation
    }
