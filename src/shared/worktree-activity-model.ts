/** Contrats partagés de l'activité et de l'état des worktrees. */

export type WorktreeState =
  | 'isolated'
  | 'working'
  | 'ready'
  | 'merged'
  | 'conflict'
  | 'blocked'
  /** Le run tournait quand l'application s'est arrêtée : personne ne l'a bloqué, il a été coupé. */
  | 'interrupted'
export type FileChangeKind = 'add' | 'mod' | 'del'

export interface WorktreeRuntimeStatus {
  available: boolean
  workspacePath: string
  repoId?: string
  reason?: 'not-git' | 'identity-unavailable'
}

export type WorktreeConflictDiffResult =
  | { available: true; agentId: string; paths: string[]; diff: string }
  | {
      available: false
      reason:
        | 'invalid-agent'
        | 'not-conflict'
        | 'ownership-unproven'
        | 'invalid-path'
        | 'revision-unavailable'
        | 'read-failed'
    }

/** Choix humain devant un conflit : garder le travail de l'agent, ou garder le workspace. */
export type WorktreeConflictResolutionChoice = 'agent' | 'mine'

export type WorktreeConflictResolutionResult =
  | { resolved: true; agentId: string; outcome: 'merged' | 'nothing' }
  | {
      resolved: false
      reason: 'invalid-agent' | 'not-conflict' | 'unsupported' | 'still-conflicting' | 'blocked'
      detail?: string
    }

export interface WorktreeFileChange {
  path: string
  kind: FileChangeKind
}

/** Activité brute d'un agent sur SA copie isolée (fournie par l'orchestration). */
export interface WorktreeAgentActivity {
  agentId: string
  agentName: string
  role?: string
  state: WorktreeState
  files: WorktreeFileChange[]
  startedAtMs: number
  /** Fin (merge réussi ou conflit détecté) ; absent si l'agent travaille encore. */
  endedAtMs?: number
  /** Noms des autres agents touchant le même fichier (rempli quand state = conflict). */
  conflictWith?: string[]
  /** Fichier en cause du conflit (affiché à l'utilisateur). */
  conflictFile?: string
  /** Pourquoi la copie attend sans être un conflit entre agents. */
  attentionReason?:
    'base-dirty' | 'base-in-progress' | 'merge-failed' | 'post-publish-change' | 'retry-exhausted'
  /** Contexte durable du bureau, affiché par le Hub A2. */
  task?: string
  worktreePath?: string
  /** Faux quand la ref est protégée mais que le dossier doit encore être rematérialisé. */
  worktreeAvailable?: boolean
  workspacePath?: string
  baseBranch?: string
  baseSha?: string
  sourceSha?: string
  canonicalBaseRef?: string
  excludedDirtyFiles?: string[]
  excludedDirtyFileCount?: number
  excludedDirtyFilesTruncated?: boolean
  publishedSha?: string
  verdict?: 'unknown' | 'running' | 'green' | 'red' | 'cancelled' | 'interrupted'
  publication?:
    | 'not-requested'
    | 'pending'
    | 'integrating'
    | 'published'
    | 'held'
    | 'cleanup-pending'
    | 'complete'
    | 'blocked'
  recovered?: boolean
  detail?: string
  retryCount?: number
}

/**
 * État d'affichage d'un bureau reconstruit au démarrage, à partir de son enregistrement.
 *
 * Mesuré le 2026-08-12 : la vue annonçait 146 bureaux « bloqués » pour SEPT qui retenaient
 * réellement du travail vert. 118 d'entre eux étaient des runs coupés par un arrêt de
 * l'application, étiquetés `blocked` avec `merge-failed` PAR DÉFAUT — alors qu'aucune fusion
 * n'avait été tentée. Le signal utile était noyé d'un facteur 20.
 *
 * Un run interrompu n'appelle aucune action humaine : il a été coupé, pas refusé.
 */
export function etatBureauRecupere(record: {
  verdict?: string
  attentionReason?: WorktreeAgentActivity['attentionReason']
}): { state: WorktreeState; attentionReason?: WorktreeAgentActivity['attentionReason'] } {
  if (record.verdict === 'running' || record.verdict === 'interrupted') {
    return { state: 'interrupted' }
  }
  // Hors interruption, le defaut historique est conserve : une copie sans raison enregistree dont
  // le processus a disparu EST une anomalie a traiter (test « sort de working une copie sans
  // manifeste »). On ne retire le defaut que la ou il mentait — l'arret de l'application.
  return { state: 'blocked', attentionReason: record.attentionReason ?? 'merge-failed' }
}

/** Source unique pour décider si un bureau attend une action humaine. */
export function requiresAttention(agent: WorktreeAgentActivity): boolean {
  // Un run coupé par un arrêt de l'app n'attend personne : il attend d'être relancé ou oublié.
  if (agent.state === 'interrupted') return false
  if (agent.state === 'conflict') return true
  if (
    agent.attentionReason === 'retry-exhausted' ||
    agent.attentionReason === 'post-publish-change'
  ) {
    return true
  }
  return agent.state === 'blocked' && agent.attentionReason !== 'base-in-progress'
}

/**
 * Durée réelle d'un bureau, exprimée sans jargon. `endedAtMs` fige la durée d'un bureau terminé ;
 * sinon la mesure court jusqu'à `nowMs`. Rend `undefined` quand rien n'est mesurable (jamais
 * d'invention : une horloge absente ou incohérente n'affiche pas de durée).
 */
export function formatOfficeDuration(
  agent: WorktreeAgentActivity,
  nowMs?: number
): string | undefined {
  const end = agent.endedAtMs ?? nowMs
  if (typeof end !== 'number' || !Number.isFinite(end)) return undefined
  if (!Number.isFinite(agent.startedAtMs)) return undefined
  const elapsed = end - agent.startedAtMs
  if (elapsed < 0) return undefined
  const minutes = Math.floor(elapsed / 60_000)
  if (minutes < 1) return 'moins d’une minute'
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`
}

/** Ordre d'affichage : les bureaux qui attendent une décision d'abord, conflits en tête. */
export function sortOfficesByAttention(
  agents: readonly WorktreeAgentActivity[]
): WorktreeAgentActivity[] {
  const rank = (agent: WorktreeAgentActivity): number => {
    if (agent.state === 'conflict') return 0
    if (requiresAttention(agent)) return 1
    return 2
  }
  return [...agents]
    .map((agent, index) => ({ agent, index }))
    .sort((a, b) => rank(a.agent) - rank(b.agent) || a.index - b.index)
    .map((entry) => entry.agent)
}

/**
 * Un message ACTIONNABLE par raison réelle : « comparaison indisponible » seul ne disait pas
 * quoi faire ensuite, ni si le bureau était perdu (il ne l'est jamais).
 */
export function conflictDiffMessage(
  reason: Extract<WorktreeConflictDiffResult, { available: false }>['reason']
): string {
  const messages: Record<typeof reason, string> = {
    'invalid-agent':
      'Comparaison indisponible : ce bureau n’est plus connu d’Autowin. Rafraîchis le Hub ; le dossier du bureau reste conservé.',
    'not-conflict':
      'Comparaison indisponible : ce bureau n’est plus en conflit. Son état a changé — rafraîchis le Hub pour voir où il en est.',
    'ownership-unproven':
      'Comparaison indisponible : le dossier du bureau n’appartient plus à ce workspace. Ouvre le bureau protégé pour vérifier son contenu avant toute décision.',
    'invalid-path':
      'Comparaison indisponible : les fichiers en conflit ne sont pas lisibles depuis ce dépôt. Ouvre le bureau protégé pour les inspecter.',
    'revision-unavailable':
      'Comparaison indisponible : les deux versions ne sont plus présentes dans ce dépôt (objets nettoyés). Le bureau reste conservé sur le disque.',
    'read-failed':
      'Comparaison indisponible : la lecture des deux versions a échoué. Réessaie ; le bureau reste conservé.'
  }
  return messages[reason]
}
