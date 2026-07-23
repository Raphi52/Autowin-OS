import { useEffect, useState } from 'react'
import { WorktreeActivityView } from './WorktreeActivityView'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import './ChatWorktreePanel.css'

/**
 * Intègre l'activité worktree DIRECTEMENT dans la vue chat : quand des agents travaillent dans des
 * copies isolées, une bande compacte apparaît sous l'en-tête de conversation (repliée par défaut),
 * dépliable pour voir la frise + le journal (réutilise `WorktreeActivityView`, pas de duplication).
 * Ne rend RIEN quand il n'y a aucune activité → zéro encombrement du chat au repos.
 */
export function ChatWorktreePanel(): React.JSX.Element | null {
  const [activity, setActivity] = useState<WorktreeAgentActivity[]>([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    let alive = true
    // Garde défensive : l'IPC worktree peut être absente (mock de test, env sans repo git).
    void window.api.getWorktreeActivity?.().then((a) => {
      if (alive) setActivity(a)
    })
    const off = window.api.onWorktreeActivity?.((a) => setActivity(a))
    return () => {
      alive = false
      off?.()
    }
  }, [])

  if (activity.length === 0) return null

  const count = activity.length
  return (
    <section className="chat-worktree" data-testid="chat-worktree-panel">
      <button
        type="button"
        className="cwt-strip"
        data-testid="chat-worktree-toggle"
        aria-expanded={expanded}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="cwt-glyph" aria-hidden="true">🌳</span>
        <span className="cwt-label">
          {count} {count > 1 ? 'copies d’agent en cours' : 'copie d’agent en cours'}
        </span>
        <span className="cwt-chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="cwt-body">
          <WorktreeActivityView
            agents={activity}
            onResolveConflict={(agentId) => console.info('[chat-worktree] merge assisté', agentId)}
          />
        </div>
      )}
    </section>
  )
}
