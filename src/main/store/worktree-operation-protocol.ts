import type { WorktreeRecoveryContext, WorktreeRunContext } from './worktree-manager'

export interface WorktreeRecoveryInventory {
  residues: {
    cleaned: number
    recovered: string[]
    blocked: Array<{ path: string; detail: string }>
    swept?: string[]
  }
  agents: Array<{
    agentId: string
    context?: WorktreeRunContext
    active: boolean
    changedFiles: string[]
  }>
}

export type WorktreeOperationRequest =
  | { operation: 'prepare'; agentId: string; context?: WorktreeRunContext }
  | { operation: 'changedFiles'; agentId: string }
  /** Fichiers libres ET deja commites de la copie (`fichiersDuTravailDeLaCopie`). */
  | { operation: 'fichiersDuTravail'; agentId: string }
  | {
      operation: 'finalize'
      agentId: string
      options?: {
        baseBranch?: string
        expectedAgentSha?: string
        task?: string
        conflictStrategy?: 'ours' | 'theirs'
      }
    }
  | {
      operation: 'cleanupPublished'
      agentId: string
      publishedSha: string
      agentSha: string
      baseBranch?: string
    }
  | { operation: 'acknowledgePublication'; agentId: string; publishedSha: string }
  /**
   * `copiesProtegees` : les copies dont le point de reprise vit encore. Le worker a SON gestionnaire,
   * qui ne voit pas la garde du fil principal : sans ce champ, son balayage retire une copie reprenable.
   */
  | { operation: 'recoveryInventory'; copiesProtegees?: string[] }
  /**
   * Le recensement des travaux non publies, ENTIEREMENT dans le worker.
   *
   * Il coute une commande git par branche : paye sur le thread main, il a bloque la fenetre
   * 14 403 ms au demarrage (mesure du 2026-08-29, detecteur de gel).
   */
  | { operation: 'recensementNonPublies'; baseRef?: string; limite?: number }
  /**
   * La passe de retention (un `git cherry` par ref de secours), ENTIEREMENT dans le worker : sur le
   * thread main, la seule creation des 78 processus a gele la fenetre jusqu'a 8,8 s au demarrage
   * (gels.jsonl, 14-16/10). Rend des `VerdictRetention` ; la consigne s'applique
   * cote appelant.
   */
  | { operation: 'verdictsRetention' }
  | { operation: 'commitsDejaReferences'; shas: string[] }
  | { operation: 'describe'; agentId: string }
  | { operation: 'hasActiveProcesses'; agentId: string }
  | { operation: 'discard'; agentId: string }
  | { operation: 'validateRecoveryContext'; agentId: string; context: WorktreeRecoveryContext }
  | {
      operation: 'readConflictDiff'
      agentId: string
      snapshot: { files: string[]; baseSha: string; agentSha: string }
    }

export type WorktreeOperationResponse =
  | { type: 'prepared'; agentSha: string; baseSha: string }
  | { type: 'integrated'; integratedSha: string; agentSha: string; baseSha: string }
  /**
   * `termineA` : l'heure (ms) où le worker a FINI l'opération. Le délai juge sur elle, et non sur
   * l'heure où le fil principal reçoit la réponse : un fil principal tenu peut la recevoir après
   * l'échéance, alors que le travail était fini à temps (ou ne l'était pas).
   */
  | { type: 'result'; value: unknown; termineA: number }
  | { type: 'error'; error: string; termineA: number }
  /**
   * Une commande git du worker, signalée PENDANT qu'elle tourne. C'est la seule trace de ce qu'une
   * opération attend : au délai, le fil principal nomme la commande démarrée et jamais finie.
   * Ce n'est pas un résultat : le client le lit sans terminer l'opération. L'identifiant relie le
   * début à sa fin, quand plusieurs commandes tournent à la fois.
   */
  | { type: 'etape'; phase: 'debut'; id: number; commande: string; ms: number }
  | { type: 'etape'; phase: 'fin'; id: number; commande: string; ms: number; code: number }
