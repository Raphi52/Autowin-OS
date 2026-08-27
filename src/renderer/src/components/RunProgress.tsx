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
          <li
            key={e.key}
            className="run-progress__step"
            data-testid="run-progress-step"
            data-state={e.state}
          >
            <span className="run-progress__dot" aria-hidden="true" />
            <div className="run-progress__body">
              <div className="run-progress__head">
                <b>{e.label}</b>
                {e.model && <span className="mono c-faint">{e.model}</span>}
                {e.tokens ? <i className="c-faint tnum">{e.tokens} tk</i> : null}
              </div>
              {e.obstacles.length > 0 && (
                <ul className="run-progress__obstacles">
                  {e.obstacles.map((o, i) => (
                    <li key={i}>{o}</li>
                  ))}
                </ul>
              )}
              {e.evidence.length > 0 && (
                <ul className="run-progress__evidence">
                  {e.evidence.map((ev, i) => (
                    <li key={i} className={ev.ok ? 'st-ok' : 'st-err'}>
                      {ev.summary}
                    </li>
                  ))}
                </ul>
              )}
              {e.thinking && (
                <details className="run-progress__thinking">
                  <summary>Raisonnement</summary>
                  <pre>{e.thinking}</pre>
                </details>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
