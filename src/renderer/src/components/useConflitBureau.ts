import { useRef, useState } from 'react'
import type {
  WorktreeConflictDiffResult,
  WorktreeConflictResolutionChoice
} from '../../../shared/worktree-activity-model'

export interface ConflitBureau {
  /** Bureau dont la comparaison est ouverte, `null` si aucune. */
  conflictAgentId: string | null
  /** `null` = comparaison en cours de préparation. */
  conflictDiff: WorktreeConflictDiffResult | null
  /** Message de résultat après une résolution réussie. */
  conflictResolution: string | undefined
  openConflictDiff: (agentId: string) => void
  closeConflictDiff: () => void
  resolveConflictChoice: (
    agentId: string,
    choice: WorktreeConflictResolutionChoice
  ) => Promise<void>
}

/**
 * L'ouverture de la comparaison et le choix de résolution d'un bureau en conflit.
 *
 * Partagé entre le panneau de droite du chat et la vue Worktrees : deux copies de cette logique
 * dériveraient, et le refus du processus principal (« rien n'a été écrasé ») doit être dit
 * exactement pareil des deux côtés.
 */
export function useConflitBureau(): ConflitBureau {
  const [conflictAgentId, setConflictAgentId] = useState<string | null>(null)
  const [conflictDiff, setConflictDiff] = useState<WorktreeConflictDiffResult | null>(null)
  const [conflictResolution, setConflictResolution] = useState<string | undefined>(undefined)
  const conflictRequestRef = useRef(0)

  const openConflictDiff = (agentId: string): void => {
    const requestId = ++conflictRequestRef.current
    setConflictAgentId(agentId)
    setConflictDiff(null)
    const request = window.api.getWorktreeConflictDiff?.(agentId)
    if (!request) {
      setConflictDiff({ available: false, reason: 'read-failed' })
      return
    }
    void request
      .then((result) => {
        if (conflictRequestRef.current === requestId) {
          setConflictDiff(result as WorktreeConflictDiffResult)
        }
      })
      .catch(() => {
        if (conflictRequestRef.current === requestId) {
          setConflictDiff({ available: false, reason: 'read-failed' })
        }
      })
  }

  const closeConflictDiff = (): void => {
    conflictRequestRef.current += 1
    setConflictAgentId(null)
    setConflictDiff(null)
  }

  const resolveConflictChoice = async (
    agentId: string,
    choice: WorktreeConflictResolutionChoice
  ): Promise<void> => {
    setConflictResolution(undefined)
    const request = window.api.resolveWorktreeConflict?.(agentId, choice)
    if (!request) throw new Error('Résolution indisponible depuis cette fenêtre.')
    const result = await request
    if (result.resolved) {
      closeConflictDiff()
      setConflictResolution(
        choice === 'agent'
          ? 'Version de l’agent appliquée : les changements sont dans ton workspace.'
          : 'Ta version est conservée : le bureau agent n’a rien écrasé.'
      )
      return
    }
    const reasons: Record<typeof result.reason, string> = {
      'invalid-agent': 'Ce bureau n’est plus connu d’Autowin.',
      'not-conflict': 'Ce bureau n’est plus en conflit ; actualise la liste.',
      unsupported: 'La résolution n’est pas disponible sur cette installation.',
      'still-conflicting': 'Le conflit persiste : ouvre le bureau protégé pour trancher à la main.',
      blocked: 'Résolution refusée pour protéger ton workspace.'
    }
    throw new Error(
      `${reasons[result.reason]}${result.detail ? ` ${result.detail}` : ''} Rien n’a été écrasé.`
    )
  }

  return {
    conflictAgentId,
    conflictDiff,
    conflictResolution,
    openConflictDiff,
    closeConflictDiff,
    resolveConflictChoice
  }
}
