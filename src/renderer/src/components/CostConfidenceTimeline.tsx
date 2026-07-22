import React from 'react'
import type { OrchestrationStep } from '../../../main/orchestrator'
import { buildCostConfidenceTimeline } from '../../../shared/cost-confidence-timeline'
import './CostConfidenceTimeline.css'

/**
 * #6 — Timeline coût/confiance type CI/CD : chaque phase du pipeline est une barre horizontale
 * (largeur = durée, position = offset waterfall) colorée par échec/succès, avec coût $ et tokens.
 * Rend le diagnostic "quelle phase a explosé le budget / a échoué" instantané, au lieu de logs texte.
 */
export function CostConfidenceTimeline({
  steps,
  className
}: {
  steps: OrchestrationStep[]
  className?: string
}): React.JSX.Element {
  const timeline = buildCostConfidenceTimeline(steps)
  const total = Math.max(timeline.totalMs, 1)
  return (
    <div className={`cc-timeline ${className ?? ''}`} data-testid="cc-timeline">
      <header className="cc-timeline-head">
        <span className="cc-timeline-total">
          {(timeline.totalMs / 1000).toFixed(1)}s · ${timeline.totalUsd.toFixed(4)} ·{' '}
          {timeline.totalTokens.toLocaleString()} tok
        </span>
        <span className={`cc-timeline-conf ${timeline.confidence ? 'ok' : 'ko'}`}>
          {timeline.confidence ? 'validé' : 'non validé'}
        </span>
      </header>
      <div className="cc-timeline-track">
        {timeline.segments.map((seg) => (
          <div
            key={seg.index}
            className={`cc-seg ${seg.ok ? 'ok' : 'ko'}`}
            data-testid="cc-seg"
            title={`${seg.label} · ${(seg.durationMs / 1000).toFixed(1)}s · $${seg.costUsd.toFixed(4)} · ${seg.tokens} tok${seg.ok ? '' : ' · échec'}`}
            style={{
              left: `${(seg.offsetMs / total) * 100}%`,
              width: `${Math.max((seg.durationMs / total) * 100, 1.5)}%`
            }}
          >
            <span className="cc-seg-label">{seg.label}</span>
          </div>
        ))}
        {timeline.segments.length === 0 && <div className="cc-timeline-empty">Aucune phase</div>}
      </div>
    </div>
  )
}
