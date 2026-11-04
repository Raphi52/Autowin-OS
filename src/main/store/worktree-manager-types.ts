/**
 * Types publics et internes de WorktreeManager (résultat de finalisation, contextes, options,
 * plans de compensation). Extraits tels quels de worktree-manager.ts (conv-1508), qui les ré-exporte.
 */
/**
 * L'EDITION NON COMMITEE DE L'UTILISATEUR N'A PAS PU ETRE REMISE DANS SES FICHIERS (barreau 2).
 *
 * Vecu le 2026-10-24 (conv-1139, run run-58bfc90f8f7b-1) : la publication a atterri, deux fichiers
 * modifies par l'utilisateur et touches par un commit entrant sont restes dans `stash@{0}`, revenus
 * a la version commitee, et le compte rendu disait seulement « integre ». Ce champ porte le constat
 * jusqu'au compte rendu (`annonce-edition-locale.ts`) : les fichiers, et ou leur version se trouve.
 */
export interface EditionLocaleNonRemise {
  /** Fichiers dont la version de l'utilisateur n'est PAS dans l'arbre de travail. Vide = tous remis. */
  fichiers: string[]
  /** Adresse durable de son etat d'avant (`refs/autowin/safety/<agent>`), ecrite avant tout geste. */
  sauvegarde: string
  /** Sha de la remise de cote encore presente dans `git stash list`, si elle n'a pas pu etre retiree. */
  remise?: string
  /** Ce que git a repondu, en clair. */
  cause: string
}

export type FinalizeResult =
  | {
      outcome: 'merged'
      agentId: string
      committed: boolean
      /** HEAD de la branche cible juste avant l'intégration. */
      baseSha?: string
      /** Commit exact publié dans la branche cible (peut être un commit de merge). */
      publishedSha?: string
      /** Barreau 2 seulement : publication faite, mais l'edition locale n'a pas ete toute remise. */
      editionLocaleNonRemise?: EditionLocaleNonRemise
    }
  | { outcome: 'nothing'; agentId: string }
  /**
   * PAS ENCORE — l'attente, distincte de l'absence d'issue.
   *
   * `undefined` disait DEUX choses incompatibles : « rien a faire » et « pas encore ». Mesure le
   * 2026-08-31 (conv-1, run « reprend-pardon-mthg437j », 2,13 $) : la copie avait encore des
   * processus vivants — typiquement les workers `vitest` que la verification vient elle-meme de
   * lancer (deja documente conv-1404) —, la finalisation a ete DIFFEREE puis publiee par
   * `retryRecovery`, mais l'orchestrateur avait deja rendu un rouge « integration locale non
   * terminee » SANS cause. Face a un faux echec, l'agent RECOMMENCE.
   *
   * Ce n'est ni un echec ni une publication : c'est une attente, et elle porte sa cause.
   */
  | {
      outcome: 'deferred'
      agentId: string
      files: string[]
      reason: 'processes-still-running'
      detail?: string
    }
  | {
      outcome: 'conflict'
      agentId: string
      files: string[]
      baseSha: string
      agentSha: string
      /** Adresse durable du travail refusé, quand une a pu être posée. Voir `outcome: 'blocked'`. */
      rescueRef?: string
    }
  | {
      outcome: 'cleanup-pending'
      agentId: string
      files: string[]
      /** Commit réellement installé sur la branche cible. */
      publishedSha: string
      /** HEAD de la copie agent, distinct d'un éventuel commit de merge. */
      agentSha?: string
      baseSha?: string
      detail?: string
      worktreeAvailable?: boolean
    }
  | {
      outcome: 'published-residue'
      agentId: string
      files: string[]
      /** Commit réellement installé sur la branche cible. */
      publishedSha: string
      /** HEAD de la copie agent, distinct d'un éventuel commit de merge. */
      agentSha?: string
      baseSha?: string
      detail?: string
    }
  | {
      outcome: 'blocked'
      agentId: string
      files: string[]
      reason: 'base-dirty' | 'base-in-progress' | 'merge-failed' | 'ignored-deliverables'
      /** Les fichiers remontés diagnostiquent la base ; conserver la provenance agent déjà suivie. */
      preserveAgentFiles?: boolean
      /**
       * Référence git durable où le travail refusé est ATTEIGNABLE, quand une a pu être posée.
       * Absente = il n'y avait rien à sauver, ou l'adresse n'a pas pu être écrite — jamais une
       * promesse creuse : l'appelant ne doit annoncer une adresse que s'il en reçoit une.
       */
      rescueRef?: string
      /**
       * Adresse git durable posee sur le commit que la copie a DEJA produit, quand la publication est
       * refusee pour une cause REPARABLE (`base-dirty`). Le travail est donc ATTEIGNABLE et attend
       * son atterrissage, au lieu d'etre rendu comme un echec sec — vecu conv-1450, 1,32 $ payes pour
       * un « statut echoue ». N'ecrit RIEN dans l'arbre de l'utilisateur : voir
       * `worktree-manager.attente-integration.test.ts`.
       */
      stagedRef?: string
      detail?: string
      /** Barreau 2 seulement : publication refusee, et l'edition locale n'a pas ete toute remise. */
      editionLocaleNonRemise?: EditionLocaleNonRemise
    }

export interface WorktreeRunContext {
  workspacePath: string
  worktreePath: string
  baseBranch: string
  baseSha: string
  /** Révision exacte remise à l'agent. Absente dans les anciens manifestes = baseSha. */
  sourceSha?: string
  /** Base distante fraîche dont sourceSha contient l'historique, par ex. origin/main. */
  canonicalBaseRef?: string
  /** Changements du workspace volontairement exclus du snapshot commité. */
  excludedDirtyFiles?: string[]
  /** Total réel, conservé même si la liste d'affichage est bornée. */
  excludedDirtyFileCount?: number
  excludedDirtyFilesTruncated?: boolean
  /** Commits locaux non poussés exclus du snapshot quand la base a divergé d'origin. */
  excludedLocalCommits?: string[]
  excludedLocalCommitCount?: number
}

export interface WorktreeRecoveryContext extends Omit<WorktreeRunContext, 'workspacePath'> {
  publication: 'pending' | 'integrating' | 'published' | 'cleanup-pending'
  /** Commit réellement installé dans la branche cible. */
  publishedSha?: string
  /** HEAD de la copie agent préparée, avant un éventuel commit de merge. */
  agentSha?: string
}

export interface PublicationCompensationPlan {
  version: 2
  generation?: string
  phase: 'pending' | 'compensated'
  stage: 0 | 1 | 2 | 3 | 4
  agentId: string
  baseSha: string
  publicationSha: string
  expectedBaseBranch: string
  branchPublished: boolean
  agentFiles: string[]
  indexedAgentPaths: string[]
  worktreeAgentPaths: string[]
  untrackedAgentPaths: string[]
  postHookIndexTree: string
  postHookWorktreeTree: string
  resumeIndexTree: string
  resumeWorktreeTree: string
  nextIndexTree?: string
  nextWorktreeTree?: string
}

export interface PublicationCompensationIntent {
  version: 1
  agentId: string
  baseSha: string
  publicationSha: string
  expectedBaseBranch: string
  agentFiles: string[]
}

export interface CompensationIndexLockOwner {
  owner: 'autowin-compensation'
  pid: number
  identity: string | null
  token: string
  predecessorSerialized?: string | null
  acquireExpiresAt?: number
}

export interface CompensationIndexLock {
  path: string
  serialized: string
  ownershipRef: string
  ownershipOid: string
  token: string
}

export interface CompensationIndexRecoveryMarker {
  version: 1
  token: string
  state: 'acquiring' | 'abandoned'
  predecessorSerialized: string | null
  expiresAt: number
}
