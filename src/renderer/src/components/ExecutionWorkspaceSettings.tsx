import { useCallback, useEffect, useState } from 'react'
import type { ExecutionWorkspaceState } from '../../../shared/preload-contracts'

/**
 * Voir et changer le DOSSIER DE TRAVAIL : le dépôt sur lequel les runs s'exécutent.
 *
 * Ne pas confondre avec le sélecteur de la section « Comportement » : celui-là n'inspecte que les
 * fichiers d'instructions d'un dossier et ne change rien à l'exécution.
 *
 * Le dossier actif est figé au démarrage (`os.executionWorkspace` est en lecture seule et propagé
 * partout) : un nouveau choix ne prend donc effet qu'au redémarrage, et l'écran le DIT.
 */
export function ExecutionWorkspaceSettings(): React.JSX.Element {
  const [state, setState] = useState<ExecutionWorkspaceState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setState(await window.api.executionWorkspace())
      setError(null)
    } catch {
      setError('Impossible de lire le dossier de travail.')
    }
  }, [])

  useEffect(() => {
    // `queueMicrotask` : meme motif que BehaviourView — la lecture initiale ne doit pas poser
    // d'etat SYNCHRONEMENT dans l'effet (cascade de rendus).
    queueMicrotask(() => void load())
  }, [load])

  const run = useCallback(async (action: () => Promise<ExecutionWorkspaceState>) => {
    setBusy(true)
    try {
      setState(await action())
      setError(null)
    } catch {
      setError('Le changement de dossier a échoué. Réessaie.')
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <section
      className="settings-execution-workspace surface-panel"
      aria-label="Dossier de travail"
      data-testid="execution-workspace"
    >
      <header>
        <div>
          <span className="domain-eyebrow">Configuration locale</span>
          <h2>Dossier de travail</h2>
        </div>
        <button
          type="button"
          disabled={busy}
          data-testid="execution-workspace-choose"
          onClick={() => void run(() => window.api.chooseExecutionWorkspace())}
        >
          {busy ? 'Enregistrement…' : 'Changer de dossier'}
        </button>
      </header>
      <p>Le dépôt sur lequel Autowin travaille, celui que lisent et modifient les agents.</p>
      {error && (
        <p className="domain-warning" role="alert">
          {error}
        </p>
      )}
      {state && (
        <>
          <p data-testid="execution-workspace-active">
            Actif : <code>{state.path}</code>
          </p>
          {!state.isGitRepo && (
            <p className="domain-warning" data-testid="execution-workspace-no-git">
              Ce dossier n’est pas un dépôt git : les copies de travail isolées sont désactivées.
            </p>
          )}
          {state.chosen && (
            <p data-testid="execution-workspace-chosen">
              Choisi : <code>{state.chosen}</code>{' '}
              <button
                type="button"
                disabled={busy}
                data-testid="execution-workspace-reset"
                onClick={() => void run(() => window.api.resetExecutionWorkspace())}
              >
                Revenir à la détection automatique
              </button>
            </p>
          )}
          {state.restartRequired && (
            <p className="domain-warning" role="status" data-testid="execution-workspace-restart">
              Redémarre Autowin pour que ce dossier devienne actif.
            </p>
          )}
        </>
      )}
    </section>
  )
}
