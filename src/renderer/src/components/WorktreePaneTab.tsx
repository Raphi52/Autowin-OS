import { useEffect, useState } from 'react'
import { WorktreeActivityView } from './WorktreeActivityView'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'

/**
 * Onglet "Worktrees" de la colonne droite du chat (à côté de Runs / Activité) : rend l'activité
 * worktree en VERTICAL, adapté à la colonne étroite. Réutilise WorktreeActivityView (rendu pur).
 */
export function WorktreePaneTab(): React.JSX.Element {
  const [activity, setActivity] = useState<WorktreeAgentActivity[]>([])

  useEffect(() => {
    let alive = true
    void window.api.getWorktreeActivity?.().then((a) => {
      if (alive) setActivity(a)
    })
    const off = window.api.onWorktreeActivity?.((a) => setActivity(a))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  if (activity.length === 0) {
    return (
      <div className="worktree-pane-empty" data-testid="worktree-pane-empty">
        Aucune copie en cours. Les agents travaillent chacun à part ; leur activité s’affichera ici.
      </div>
    )
  }
  return (
    <div className="worktree-pane" data-testid="worktree-pane">
      <WorktreeActivityView
        agents={activity}
        onResolveConflict={(agentId) => console.info('[worktree-pane] merge assisté', agentId)}
      />
    </div>
  )
}
