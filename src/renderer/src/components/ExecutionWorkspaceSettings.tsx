import { useCallback, useEffect, useState } from 'react'
import type { ExecutionWorkspaceState } from '../../../shared/preload-contracts'
import { langueCourante } from '../langue'
import { traduire, useTextes } from '../textes'

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
  // Textes dans la langue de Settings · Interface (conv-1146, réparation 3 : la page Diagnostic était
  // annoncée traduite alors que ce panneau restait en français).
  const { t } = useTextes()
  const [state, setState] = useState<ExecutionWorkspaceState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setState(await window.api.executionWorkspace())
      setError(null)
    } catch {
      setError(traduire('dossierTravail.erreurLecture', langueCourante()))
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
      setError(traduire('dossierTravail.erreurChangement', langueCourante()))
    } finally {
      setBusy(false)
    }
  }, [])

  return (
    <section
      className="settings-execution-workspace surface-panel"
      aria-label={t('dossierTravail.titre')}
      data-testid="execution-workspace"
    >
      <header>
        <div>
          <span className="domain-eyebrow">{t('settings.preflight.eyebrow')}</span>
          <h2>{t('dossierTravail.titre')}</h2>
        </div>
        <button
          type="button"
          className="btn"
          disabled={busy}
          data-testid="execution-workspace-choose"
          onClick={() => void run(() => window.api.chooseExecutionWorkspace())}
        >
          {busy ? t('diagnostic.enregistrement') : t('dossierTravail.changer')}
        </button>
      </header>
      <p>{t('dossierTravail.description')}</p>
      {error && (
        <p className="domain-warning" role="alert">
          {error}
        </p>
      )}
      {state && (
        <>
          <p data-testid="execution-workspace-active">
            {t('diagnostic.actif')} <code>{state.path}</code>
          </p>
          {!state.isGitRepo && (
            <p className="domain-warning" data-testid="execution-workspace-no-git">
              {t('dossierTravail.pasGit')}
            </p>
          )}
          {state.chosen && (
            <p data-testid="execution-workspace-chosen">
              {t('diagnostic.choisi')} <code>{state.chosen}</code>{' '}
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy}
                data-testid="execution-workspace-reset"
                onClick={() => void run(() => window.api.resetExecutionWorkspace())}
              >
                {t('diagnostic.revenirAuto')}
              </button>
            </p>
          )}
          {state.restartRequired && (
            <p className="domain-warning" role="status" data-testid="execution-workspace-restart">
              {t('dossierTravail.redemarrer')}
            </p>
          )}
        </>
      )}
    </section>
  )
}
