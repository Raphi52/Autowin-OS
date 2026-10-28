import { useRef, useState } from 'react'
import type {
  WorktreeConflictDiffResult,
  WorktreeConflictResolutionChoice
} from '../../../shared/worktree-activity-model'
import {
  useTextesWorktreesEtBureaux,
  type CleWorktreesEtBureaux
} from '../textes-ecrans/worktrees-et-bureaux'

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
  const { t } = useTextesWorktreesEtBureaux()
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
    if (!request) throw new Error(t('resolution.indisponible'))
    const result = await request
    if (result.resolved) {
      closeConflictDiff()
      setConflictResolution(choice === 'agent' ? t('resolution.agent') : t('resolution.mienne'))
      return
    }
    const reasons: Record<typeof result.reason, CleWorktreesEtBureaux> = {
      'invalid-agent': 'resolution.refus.agentInconnu',
      'not-conflict': 'resolution.refus.plusEnConflit',
      unsupported: 'resolution.refus.nonSupportee',
      'still-conflicting': 'resolution.refus.persiste',
      blocked: 'resolution.refus.bloquee'
    }
    // `detail` vient du processus principal : une donnée, gardée telle quelle.
    const raison = t(reasons[result.reason])
    throw new Error(
      result.detail
        ? t('resolution.echec.detail', { raison, detail: result.detail })
        : t('resolution.echec', { raison })
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
