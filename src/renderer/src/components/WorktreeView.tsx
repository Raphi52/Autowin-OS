import { useEffect, useState } from 'react'
import { WorktreeActivityView } from './WorktreeActivityView'
import { ModuleHeader } from './ModuleHeader'
import type { WorktreeAgentActivity } from '../../../shared/worktree-activity-model'
import './WorktreeView.css'

/**
 * Onglet "Worktrees" (cockpit) — conteneur : récupère l'activité worktree au montage puis s'abonne
 * aux changements live (IPC) et la passe au rendu pur `WorktreeActivityView`. Le clic "Voir les deux
 * versions" (conflit) route vers le merge assisté (à brancher — placeholder log pour l'instant).
 */
export function WorktreeView({ active }: { active: boolean }): React.JSX.Element {
  const [activity, setActivity] = useState<WorktreeAgentActivity[]>([])

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

  return (
    <section className="worktree-tab" data-active={active}>
      <header className="worktree-page-head">
        <ModuleHeader eyebrow="Travail isolé des agents" title="Worktrees" />
        <p>Chaque agent travaille dans sa copie, puis Autowin rassemble les changements.</p>
      </header>
      <WorktreeActivityView
        agents={activity}
        onResolveConflict={(agentId) => {
          // TODO(flip live, incrément suivant) : ouvrir le merge assisté (diff des deux versions).
          console.info('[worktree] merge assisté demandé pour', agentId)
        }}
      />
    </section>
  )
}
