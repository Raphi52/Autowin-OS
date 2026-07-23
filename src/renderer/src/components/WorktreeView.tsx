import { useEffect, useState } from 'react'
import { WorktreeActivityView } from './WorktreeActivityView'
import { ModuleHeader } from './ModuleHeader'
import type {
  WorktreeAgentActivity,
  WorktreeRuntimeStatus
} from '../../../shared/worktree-activity-model'
import './WorktreeView.css'

function isWorktreeRuntimeStatus(value: unknown): value is WorktreeRuntimeStatus {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof Reflect.get(value, 'available') === 'boolean'
  )
}

/**
 * Onglet "Worktrees" (cockpit) — conteneur : récupère l'activité worktree au montage puis s'abonne
 * aux changements live (IPC) et la passe au rendu pur `WorktreeActivityView`.
 */
export function WorktreeView({ active }: { active: boolean }): React.JSX.Element {
  return <WorktreeViewSession key={active ? 'active' : 'inactive'} active={active} />
}

function WorktreeViewSession({ active }: { active: boolean }): React.JSX.Element {
  const [activity, setActivity] = useState<WorktreeAgentActivity[]>([])
  const [bridgeError, setBridgeError] = useState<string>()
  const [statusError, setStatusError] = useState<string>()
  const [runtimeStatus, setRuntimeStatus] = useState<WorktreeRuntimeStatus>()
  const [activityReady, setActivityReady] = useState(false)
  const api = window.api
  const bridgeAvailable =
    typeof api?.getWorktreeActivity === 'function' &&
    typeof api?.onWorktreeActivity === 'function' &&
    typeof api?.getWorktreeStatus === 'function'

  useEffect(() => {
    if (!active || !bridgeAvailable) return

    let disposed = false
    let receivedLiveActivity = false
    if (typeof api.getWorktreeStatus === 'function') {
      void api.getWorktreeStatus().then(
        (status) => {
          if (!disposed) {
            if (isWorktreeRuntimeStatus(status)) {
              setStatusError(undefined)
              setRuntimeStatus(status)
            } else {
              setStatusError('Relance Autowin OS pour reconnecter la vue Worktrees.')
            }
          }
        },
        () => {
          if (!disposed) setStatusError('Relance Autowin OS pour reconnecter la vue Worktrees.')
        }
      )
    }
    const unsubscribe = api.onWorktreeActivity((nextActivity) => {
      receivedLiveActivity = true
      if (!disposed) {
        setBridgeError(undefined)
        setActivity(nextActivity)
        setActivityReady(true)
      }
    })
    void api.getWorktreeActivity().then(
      (nextActivity) => {
        if (!disposed && !receivedLiveActivity) {
          setBridgeError(undefined)
          setActivity(nextActivity)
          setActivityReady(true)
        }
      },
      () => {
        if (!disposed && !receivedLiveActivity)
          setBridgeError('Relance Autowin OS pour reconnecter la vue Worktrees.')
      }
    )
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [active, api, bridgeAvailable])

  const visibleBridgeError =
    active && !bridgeAvailable
      ? 'Relance Autowin OS pour charger la vue Worktrees.'
      : (statusError ?? bridgeError)

  return (
    <section className="worktree-tab" data-active={active}>
      <header className="worktree-page-head">
        <ModuleHeader eyebrow="Travail isolé des agents" title="Worktrees" />
        <p>Chaque agent travaille dans sa copie, puis Autowin rassemble les changements.</p>
      </header>
      <div className="worktree-view__body">
        {visibleBridgeError && (
          <p className="worktree-view__bridge-error" role="alert">
            {visibleBridgeError}
          </p>
        )}
        {visibleBridgeError ? null : runtimeStatus === undefined ? (
          <p className="worktree-view__loading" role="status">
            Connexion au moteur des copies…
          </p>
        ) : runtimeStatus.available === false ? (
          <div className="worktree-view__unavailable" role="alert">
            <strong>Copies isolées indisponibles pour ce dossier.</strong>
            <span>
              Le dossier ouvert contient plusieurs projets ou n’est pas un projet versionné.
            </span>
            <span>
              Définis <code>AUTOWIN_OS_WORKSPACE</code> sur le projet à utiliser, puis relance
              Autowin OS.
            </span>
          </div>
        ) : activityReady === false ? (
          <p className="worktree-view__loading" role="status">
            Connexion au moteur des copies…
          </p>
        ) : (
          <WorktreeActivityView agents={activity} />
        )}
      </div>
    </section>
  )
}
