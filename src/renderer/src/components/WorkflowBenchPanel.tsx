import { useEffect, useRef, useState } from 'react'
import { WorkflowVerdict, type VerdictRow } from './WorkflowVerdict'
import './WorkflowBenchPanel.css'

/**
 * Lancer un même objectif sous plusieurs workflows, et lire le verdict.
 *
 * Le panneau dit toujours POURQUOI il refuse de partir plutôt que d'afficher un bouton grisé muet :
 * un bouton désactivé sans explication laisse chercher, alors que la règle est simple — un objectif,
 * et au moins deux façons de faire à confronter.
 *
 * Pendant la confrontation il montre où on en est. Plusieurs runs complets s'enchaînent : sans ce
 * fil, l'attente serait indistinguable d'un plantage.
 */

interface BenchProfile {
  id: string
  name: string
}

export interface WorkflowBenchReport {
  objective: string
  rows: VerdictRow[]
  recommendedProfileId?: string
  rationale: string
  skipped?: string[]
  mode?: 'comparison' | 'tournament' | 'counterfactual'
  winnerProfileId?: string
  tournamentRationale?: string
  ranking?: VerdictRow[]
  counterfactual?: {
    diff: {
      sharedFiles: string[]
      onlyByProfile: Record<string, string[]>
      differingSharedFiles: string[]
      sameResult: boolean
    }
    arms: Array<{
      profileId: string
      profileName: string
      costUsd: number | null
      durationMs: number | null
      changedFiles: string[]
      verdict: 'eligible' | 'inconclusive' | 'rejected'
      risks: Array<{ code: string; detail: string }>
    }>
    verdict: { winnerProfileId?: string; rationale: string }
  }
}

const COURANTE = '\u0000courante'

export function WorkflowBenchPanel({
  profiles
}: {
  profiles: readonly BenchProfile[]
}): React.JSX.Element {
  const [objective, setObjective] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [tournament, setTournament] = useState(false)
  const [counterfactual, setCounterfactual] = useState(false)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; label: string }>()
  const [report, setReport] = useState<WorkflowBenchReport>()
  const [error, setError] = useState<string>()
  const vivant = useRef(true)

  useEffect(() => {
    vivant.current = true
    return () => {
      vivant.current = false
    }
  }, [])

  const toggle = (id: string): void =>
    setPicked((avant) => (avant.includes(id) ? avant.filter((x) => x !== id) : [...avant, id]))

  // La même règle que côté main, énoncée en clair : un refus muet se paie en tâtonnements.
  const empeche = !objective.trim()
    ? 'Décris l’objectif à confronter.'
    : tournament && picked.length !== 3
      ? 'Choisis exactement trois workflows pour le tournoi.'
      : counterfactual && picked.length !== 2
        ? 'Choisis exactement deux workflows pour le contrefactuel.'
        : !tournament && picked.length < 2
          ? 'Choisis au moins deux workflows : comparer un seul n’a pas de sens.'
          : undefined

  const lancer = async (): Promise<void> => {
    // L'opt-in vaut pour CE lancement seulement. Le consommer avant l'IPC garantit qu'un succès,
    // un rejet ou une annulation ne peut jamais activer silencieusement le tournoi suivant.
    const tournamentForRun = tournament
    const counterfactualForRun = counterfactual
    setTournament(false)
    setCounterfactual(false)
    setRunning(true)
    setError(undefined)
    setReport(undefined)
    setProgress({ done: 0, total: picked.length, label: '…' })
    const detach = window.api.onWorkflowBenchProgress?.((p) => {
      if (vivant.current) setProgress(p)
    })
    try {
      const ids = picked.map((id) => (id === COURANTE ? null : id))
      const resultat = (await (tournamentForRun
        ? window.api.workflowBenchRun?.(objective.trim(), ids, { mode: 'tournament' })
        : counterfactualForRun
          ? window.api.workflowBenchRun?.(objective.trim(), ids, { mode: 'counterfactual' })
          : window.api.workflowBenchRun?.(objective.trim(), ids))) as
        WorkflowBenchReport | undefined
      if (vivant.current && resultat) setReport(resultat)
    } catch (cause) {
      // Le message du main porte la raison exacte (workflow inconnu, objectif vide) : la relayer
      // vaut mieux que de la remplacer par un « échec » générique.
      if (vivant.current) setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      detach?.()
      if (vivant.current) {
        setRunning(false)
        setProgress(undefined)
      }
    }
  }

  const options: BenchProfile[] = [{ id: COURANTE, name: 'Configuration courante' }, ...profiles]

  return (
    <section className="workflow-bench" data-testid="workflow-bench">
      <h3 className="workflow-bench-title">Confronter</h3>
      <p className="workflow-bench-sub">
        Le même objectif, joué sous chaque workflow retenu, puis comparé sur ce qu’il a produit et
        ce qu’il a coûté.
      </p>

      <label className="workflow-bench-objective">
        <span>Objectif</span>
        <textarea
          data-testid="workflow-bench-objective"
          value={objective}
          rows={2}
          disabled={running}
          placeholder="Ce que les workflows doivent accomplir, à l’identique"
          onChange={(e) => setObjective(e.target.value)}
        />
      </label>

      <label className="workflow-bench-tournament">
        <input
          type="checkbox"
          data-testid="workflow-bench-tournament"
          checked={tournament}
          disabled={running}
          onChange={(event) => {
            setTournament(event.target.checked)
            if (event.target.checked) setCounterfactual(false)
          }}
        />
        <span>
          <b>Tournoi facultatif · 3 bureaux isolés</b>
          <small>OFF par défaut · aucune copie ne sera fusionnée automatiquement</small>
        </span>
      </label>

      <label className="workflow-bench-tournament">
        <input
          type="checkbox"
          data-testid="workflow-bench-counterfactual"
          checked={counterfactual}
          disabled={running}
          onChange={(event) => {
            setCounterfactual(event.target.checked)
            if (event.target.checked) setTournament(false)
          }}
        />
        <span>
          <b>Contrefactuel · 2 profils, 1 checkpoint</b>
          <small>
            Les deux bureaux restent isolés et aucun contenu n’est fusionné automatiquement
          </small>
        </span>
      </label>

      <ul className="workflow-bench-picks">
        {options.map((option) => (
          <li key={option.id}>
            <label>
              <input
                type="checkbox"
                data-testid={`workflow-bench-pick-${option.id === COURANTE ? 'courante' : option.id}`}
                checked={picked.includes(option.id)}
                disabled={running}
                onChange={() => toggle(option.id)}
              />
              <span>{option.name}</span>
            </label>
          </li>
        ))}
      </ul>

      <div className="workflow-bench-actions">
        <button
          type="button"
          data-testid="workflow-bench-run"
          disabled={running || Boolean(empeche)}
          onClick={() => void lancer()}
        >
          {running ? (
            <>
              <span className="spinner" /> Confrontation en cours…
            </>
          ) : (
            'Confronter'
          )}
        </button>
        {running && (
          <button
            type="button"
            className="workflow-bench-cancel"
            data-testid="workflow-bench-cancel"
            onClick={() => {
              setProgress((current) => (current ? { ...current, label: 'Annulation…' } : current))
              void window.api.workflowBenchCancel()
            }}
          >
            Annuler
          </button>
        )}
        {empeche && !running && <span className="workflow-bench-hint">{empeche}</span>}
      </div>

      {progress && (
        <p className="workflow-bench-progress" data-testid="workflow-bench-progress">
          {progress.done}/{progress.total} — {progress.label}
        </p>
      )}

      {error && (
        <p className="workflow-bench-error" role="alert">
          {error}
        </p>
      )}

      {report && (
        <WorkflowVerdict
          objective={report.objective}
          rows={report.ranking ?? report.rows}
          recommendedProfileId={
            report.counterfactual?.verdict.winnerProfileId ??
            report.winnerProfileId ??
            report.recommendedProfileId
          }
          rationale={
            report.counterfactual?.verdict.rationale ??
            report.tournamentRationale ??
            report.rationale
          }
          skipped={report.skipped}
        />
      )}

      {report?.counterfactual && (
        <section
          className="workflow-bench-counterfactual"
          data-testid="workflow-bench-counterfactual-result"
        >
          <h4>Écart observé</h4>
          <p>
            {report.counterfactual.diff.sharedFiles.length} fichier(s) commun(s) · livrables{' '}
            {report.counterfactual.diff.sameResult ? 'identiques' : 'différents'}
          </p>
          {report.counterfactual.diff.differingSharedFiles.length > 0 && (
            <p data-testid="workflow-bench-content-diff">
              Contenu différent : {report.counterfactual.diff.differingSharedFiles.join(', ')}
            </p>
          )}
          {report.counterfactual.arms.map((arm) => (
            <article className="workflow-bench-counterfactual-arm" key={arm.profileId || 'current'}>
              <p>
                <b>{arm.profileName}</b> · {arm.verdict} ·{' '}
                {arm.costUsd === null ? 'coût inconnu' : `${arm.costUsd.toFixed(4)} $`} ·{' '}
                {arm.durationMs === null
                  ? 'durée inconnue'
                  : `${(arm.durationMs / 1_000).toFixed(1)} s`}
              </p>
              {(report.counterfactual!.diff.onlyByProfile[arm.profileId || 'current'] ?? [])
                .length > 0 && (
                <p>
                  Fichiers propres :{' '}
                  {report.counterfactual!.diff.onlyByProfile[arm.profileId || 'current'].join(', ')}
                </p>
              )}
              {arm.risks.length > 0 && (
                <p className="workflow-bench-counterfactual-risks">
                  {arm.risks.map((risk) => risk.detail).join(' ')}
                </p>
              )}
            </article>
          ))}
        </section>
      )}
    </section>
  )
}
