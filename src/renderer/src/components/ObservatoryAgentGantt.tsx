import {
  spanGeometry,
  type AgentEnvelope,
  type AgentGantt,
  type AgentLane,
  type AgentSpan
} from './observatory-agent-gantt'
import { formatClock, formatDuration } from './observatory-timeline-axis'

/**
 * Déroulé par agent d'un tour, en tête de la Chronologie — demande utilisateur du 2026-10-11
 * (conv-232, capture à l'appui). Une ligne par agent, une barre par exécution, une bulle au survol.
 * Le calcul vit dans `observatory-agent-gantt.ts` ; ce composant ne fait que poser les barres.
 */

const STATUS_BADGE: Record<AgentSpan['status'], string | null> = {
  ok: null,
  refused: 'Refus',
  failed: 'Échec',
  open: 'Sans fin'
}
const ENVELOPE_STATUS: Record<AgentEnvelope['status'], string> = {
  ok: 'terminé',
  failed: 'terminé avec un appel en échec',
  cancelled: 'arrêté',
  open: 'en cours'
}

function formatTokens(value: number): string {
  if (value >= 1_000_000)
    return `${(value / 1_000_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} M`
  if (value >= 1_000)
    return `${(value / 1_000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} k`
  return value.toLocaleString('fr-FR')
}

function formatCost(value: number): string {
  return `${value.toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $`
}

function laneName(lane: AgentLane): string {
  return lane.variant ? `${lane.label} · ${lane.variant}` : lane.label
}

/** La bulle s'ouvre vers l'intérieur de l'axe : à droite d'une barre de gauche, et inversement. */
function anchor(left: number): 'start' | 'end' {
  return left > 55 ? 'end' : 'start'
}

export function ObservatoryAgentGantt({
  gantt,
  selectedId,
  onSelect
}: {
  gantt: AgentGantt
  selectedId?: string
  onSelect: (eventId: string) => void
}): React.JSX.Element {
  const spans = gantt.lanes.flatMap((lane) => lane.spans)
  const refused = spans.filter((span) => span.status === 'refused').length
  const failed = spans.filter((span) => span.status === 'failed').length
  const startClock = formatClock(new Date(gantt.start).toISOString())

  return (
    <section
      className="observatory-gantt"
      data-testid="observatory-agent-gantt"
      aria-label="Déroulé par agent"
      onClick={(event) => event.stopPropagation()}
    >
      <header className="observatory-gantt__head">
        <b>Déroulé par agent</b>
        <small>
          {gantt.lanes.length} ligne{gantt.lanes.length > 1 ? 's' : ''} ·{' '}
          {formatDuration(gantt.end - gantt.start)}
          {startClock ? ` · départ ${startClock}` : ''}
          {refused > 0 && <em className="is-refused"> · {refused} refus</em>}
          {failed > 0 && (
            <em className="is-failed">
              {' '}
              · {failed} échec{failed > 1 ? 's' : ''}
            </em>
          )}
        </small>
      </header>
      <div className="observatory-gantt__grid">
        <div className="observatory-gantt__axis" aria-hidden="true">
          {gantt.ticks.map((tick, index) => (
            <small
              key={tick.at}
              style={{ left: `${tick.percent}%` }}
              data-edge={index === 0 ? 'start' : tick.percent > 96 ? 'end' : undefined}
            >
              {tick.label}
            </small>
          ))}
        </div>
        {gantt.lanes.map((lane) => (
          <div
            key={lane.key}
            className="observatory-gantt__lane"
            data-phase={lane.phase}
            data-testid="observatory-gantt-lane"
          >
            <div className="observatory-gantt__who" title={lane.key}>
              <b>{laneName(lane)}</b>
              <small>{lane.model ?? 'modèle non tracé'}</small>
            </div>
            <div className="observatory-gantt__track">
              {gantt.ticks.map((tick) => (
                <i key={tick.at} style={{ left: `${tick.percent}%` }} aria-hidden="true" />
              ))}
              {lane.envelope &&
                (() => {
                  const envelope = lane.envelope
                  const { left, width } = spanGeometry(gantt, envelope)
                  return (
                    <button
                      type="button"
                      className={`observatory-gantt__envelope is-${envelope.status}${selectedId === envelope.eventId ? ' is-selected' : ''}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      aria-label={`${laneName(lane)} : tour complet, ${formatDuration(envelope.durationMs)}`}
                      onClick={() => onSelect(envelope.eventId)}
                    >
                      <span className="observatory-gantt__tip" data-anchor={anchor(left)}>
                        <span className="observatory-gantt__tip-head">
                          <b>
                            {laneName(lane)}
                            {lane.model ? ` · ${lane.model}` : ''}
                          </b>
                        </span>
                        <small>
                          Tour complet · {formatDuration(envelope.durationMs)} ·{' '}
                          {ENVELOPE_STATUS[envelope.status]}
                        </small>
                        <q>Trait fin : il attend ses agents. Trait épais : il répond.</q>
                      </span>
                    </button>
                  )
                })()}
              {lane.spans.map((span) => {
                const { left, width } = spanGeometry(gantt, span)
                const badge = STATUS_BADGE[span.status]
                const facts = [
                  span.outputTokens != null ? `${formatTokens(span.outputTokens)} tokens` : null,
                  span.costUsd != null ? formatCost(span.costUsd) : null,
                  formatDuration(span.durationMs),
                  span.actions > 0 ? `${span.actions} action${span.actions > 1 ? 's' : ''}` : null
                ].filter(Boolean)
                return (
                  <button
                    type="button"
                    key={span.id}
                    className={`observatory-gantt__bar is-${span.status}${selectedId === span.eventId ? ' is-selected' : ''}`}
                    style={{ left: `${left}%`, width: `${width}%` }}
                    data-testid="observatory-gantt-bar"
                    data-status={span.status}
                    aria-label={`${laneName(lane)} : ${formatDuration(span.durationMs)}${badge ? `, ${badge}` : ''}`}
                    onClick={() => onSelect(span.eventId)}
                  >
                    <span className="observatory-gantt__tip" data-anchor={anchor(left)}>
                      <span className="observatory-gantt__tip-head">
                        <b>
                          {laneName(lane)}
                          {span.model || lane.model ? ` · ${lane.model ?? span.model}` : ''}
                        </b>
                        {badge && <em data-status={span.status}>{badge}</em>}
                      </span>
                      <small>{facts.join(' · ')}</small>
                      {span.summary && <q>{span.summary}</q>}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
