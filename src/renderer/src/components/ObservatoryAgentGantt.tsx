import { useState, type ReactNode } from 'react'
import type React from 'react'
import {
  rejeuDeLaBarre,
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

/**
 * Position d'une barre, et son minutage quand le diagramme se REJOUE depuis le bilan du run
 * (conv-981) : la feuille l'allume a `--rejeu-delai`, pendant `--rejeu-duree`.
 */
function styleDeBarre(
  geometrie: { left: number; width: number },
  rejeu: number
): React.CSSProperties {
  const position = { left: `${geometrie.left}%`, width: `${geometrie.width}%` }
  if (rejeu <= 0) return position
  const { delaiMs, dureeMs } = rejeuDeLaBarre(geometrie)
  return {
    ...position,
    '--rejeu-delai': `${delaiMs}ms`,
    '--rejeu-duree': `${dureeMs}ms`
  } as React.CSSProperties
}

/** La bulle s'ouvre vers l'intérieur de l'axe : à droite d'une barre de gauche, et inversement. */
function anchor(left: number): 'start' | 'end' {
  return left > 55 ? 'end' : 'start'
}

/**
 * LE DÉROULÉ REJOUABLE (conv-981, 2026-10-15) : le diagramme et son bouton « Rejouer », partagés par
 * le bilan du run (panneau de droite) et la Chronologie de l'Observatory — demande « je veux un truc
 * pareil dans l'Observatory ». Le numéro du rejeu sert de clé : un second clic remonte le diagramme
 * et repart du début, sans doublon. `actions` ajoute un geste à côté du bouton (le bilan y met son
 * lien vers la version complète, dans l'Observatory).
 */
export function DerouleRejouable({
  gantt,
  libelle,
  selectedId,
  onSelect,
  actions
}: {
  gantt: AgentGantt
  /** « Rejouer ce run » dans le bilan, « Rejouer ce tour » dans l'Observatory. */
  libelle: string
  selectedId?: string
  onSelect: (eventId: string) => void
  actions?: ReactNode
}): React.JSX.Element {
  const [rejeu, setRejeu] = useState(0)
  return (
    <div className="deroule-rejouable">
      <div className="deroule-rejouable__actions">
        <button
          type="button"
          className="deroule-rejouable__bouton"
          data-testid="run-rejeu-bouton"
          onClick={() => setRejeu((n) => n + 1)}
        >
          {rejeu > 0 ? 'Rejouer encore' : libelle}
        </button>
        {actions}
      </div>
      <ObservatoryAgentGantt
        key={rejeu}
        gantt={gantt}
        rejeu={rejeu}
        onSelect={onSelect}
        {...(selectedId ? { selectedId } : {})}
      />
    </div>
  )
}

export function ObservatoryAgentGantt({
  gantt,
  selectedId,
  onSelect,
  rejeu = 0
}: {
  gantt: AgentGantt
  selectedId?: string
  onSelect: (eventId: string) => void
  /**
   * « Rejouer ce run » (conv-981) : numero du rejeu en cours, 0 = diagramme fixe. Les barres
   * s'allument alors l'une apres l'autre, a l'echelle du run ramene a 10 s.
   */
  rejeu?: number
}): React.JSX.Element {
  const spans = gantt.lanes.flatMap((lane) => lane.spans)
  const refused = spans.filter((span) => span.status === 'refused').length
  const failed = spans.filter((span) => span.status === 'failed').length
  const startClock = formatClock(new Date(gantt.start).toISOString())

  return (
    <section
      className="observatory-gantt"
      data-testid="observatory-agent-gantt"
      data-rejeu={rejeu > 0 ? rejeu : undefined}
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
              <small>{lane.detail ?? lane.model ?? 'modèle non tracé'}</small>
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
                      style={styleDeBarre({ left, width }, rejeu)}
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
                    style={styleDeBarre({ left, width }, rejeu)}
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
