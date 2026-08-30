import { buildRunProgress } from './run-progress-model'
import type { LiveRunPhase, OrchStep } from './chat-view-model'
import './RunProgress.css'

/** Vue « Avancée » d'un RUN : suivi vivant (phases, frictions, pensée, preuves) — pas le RUN.md. */
export function RunProgress({
  steps,
  activePhase
}: {
  steps: OrchStep[]
  activePhase?: LiveRunPhase
}): React.JSX.Element {
  const view = buildRunProgress(steps, activePhase)

  if (view.entries.length === 0) {
    return (
      <div className="run-progress__empty" data-testid="run-progress-empty">
        Aucune étape encore — le suivi apparaîtra dès la première phase.
      </div>
    )
  }

  return (
    <section className="run-progress" aria-label="Avancée du RUN">
      <div className="run-progress__recap" data-testid="run-progress-recap">
        <span className="badge">{view.doneCount} faites</span>
        {view.failedCount > 0 && <span className="badge st-err">{view.failedCount} en échec</span>}
        <span className="badge">{view.obstacleCount} obstacles</span>
        {view.totalCost > 0 && <span className="tnum">{view.totalCost.toFixed(4)} $</span>}
        {view.activeLabel && (
          <span className="run-progress__live">en cours · {view.activeLabel}</span>
        )}
      </div>
      <ol className="run-progress__list">
        {view.entries.map((e) => (
          <li key={e.key} className="run-progress__item">
            <details
              className="run-progress__step"
              data-testid="run-progress-step"
              data-state={e.state}
              open={e.state !== 'done'}
            >
              <summary className="run-progress__head">
                <span className="run-progress__dot" aria-hidden="true" />
                <span
                  className="run-progress__icon"
                  data-testid="run-progress-icon"
                  aria-hidden="true"
                >
                  {e.icon}
                </span>
                <b>{e.label}</b>
                {e.model && <span className="mono c-faint">{e.model}</span>}
                {e.tokens ? <i className="c-faint tnum">{e.tokens} tk</i> : null}
                {e.obstacles.length > 0 && (
                  <span className="badge st-err">
                    {e.obstacles.length} obstacle{e.obstacles.length > 1 ? 's' : ''}
                  </span>
                )}
                {e.evidence.length > 0 && (
                  <span className="badge">
                    {e.evidence.length} preuve{e.evidence.length > 1 ? 's' : ''}
                  </span>
                )}
                {e.thinking && <span className="badge c-faint">raisonnement</span>}
              </summary>
              <div className="run-progress__body">
                {e.substeps.length > 0 && (
                  <ul className="run-progress__substeps" data-testid="run-progress-substeps">
                    {e.substeps.map((sub, i) => (
                      <li
                        key={i}
                        className="run-progress__substep"
                        data-testid="run-progress-substep"
                        data-state={sub.state}
                      >
                        <span
                          className="run-progress__substep-icon"
                          data-testid="run-progress-substep-icon"
                          aria-hidden="true"
                        >
                          {sub.icon}
                        </span>
                        <span className="run-progress__substep-label">{sub.label}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {e.thinking && <pre className="run-progress__thinking">{e.thinking}</pre>}
              </div>
            </details>
          </li>
        ))}
      </ol>
    </section>
  )
}
