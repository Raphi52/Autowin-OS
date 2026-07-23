import React from 'react'
import {
  buildWorktreeActivity,
  type WorktreeActivityModel,
  type WorktreeAgentActivity,
  type FriezeLane,
  type JournalEntry
} from '../../../shared/worktree-activity-model'
import './WorktreeActivityView.css'

/**
 * Cockpit worktree — direction "Mix 2" (validée user) : une frise "métro" SVG en tête donne la vue
 * d'ensemble (les copies partent de ton code et y reviennent), un journal chronologique en langage
 * humain donne le détail dessous. Zéro jargon git. Rendu pur depuis le modèle.
 */

const VW = 1180 // largeur logique du viewBox de la frise
const MAIN_Y = 46
const LANE_Y = 100
const PAD = 60 // marge gauche/droite pour que les courbes ne collent pas au bord

function laneColor(outcome: FriezeLane['outcome']): string {
  if (outcome === 'merged') return 'var(--wt-ok)'
  if (outcome === 'conflict') return 'var(--wt-warn)'
  return 'var(--wt-accent)'
}

/** Courbe bézier : part de la ligne principale (start) vers la lane, puis revient (end) si fermée. */
function lanePath(lane: FriezeLane): { d: string; endX: number; endY: number } {
  const usable = VW - PAD * 2
  const sx = PAD + lane.startOffset * usable
  if (lane.endOffset == null) {
    // Copie ouverte : descend vers la lane et s'arrête (pas de retour).
    const midX = sx + 70
    const stopX = Math.min(sx + 150, VW - PAD)
    return {
      d: `M${sx} ${MAIN_Y} C${sx + 35} ${MAIN_Y}, ${midX} ${LANE_Y}, ${midX + 40} ${LANE_Y} L${stopX} ${LANE_Y}`,
      endX: stopX,
      endY: LANE_Y
    }
  }
  const ex = PAD + lane.endOffset * usable
  const midOut = sx + 45
  const midIn = ex - 45
  return {
    d: `M${sx} ${MAIN_Y} C${sx + 35} ${MAIN_Y}, ${midOut} ${LANE_Y}, ${midOut + 30} ${LANE_Y} L${midIn - 30} ${LANE_Y} C${midIn} ${LANE_Y}, ${ex - 35} ${MAIN_Y}, ${ex} ${MAIN_Y}`,
    endX: ex,
    endY: MAIN_Y
  }
}

function Frieze({ model }: { model: WorktreeActivityModel }): React.JSX.Element {
  return (
    <div className="wt-frieze" data-testid="wt-frieze">
      <div className="wt-frieze-label">LE FLUX D’UN COUP D’ŒIL</div>
      <svg
        viewBox={`0 0 ${VW} 130`}
        width="100%"
        height="130"
        preserveAspectRatio="xMidYMid meet"
        fill="none"
        role="img"
        aria-label="Vue d’ensemble des copies de travail"
      >
        <line
          x1={PAD - 40}
          y1={MAIN_Y}
          x2={VW - 20}
          y2={MAIN_Y}
          stroke="var(--gold)"
          strokeWidth={3}
          strokeLinecap="round"
        />
        <text x={PAD - 40} y={MAIN_Y - 16} fill="var(--wt-muted)" fontSize={12}>
          ton code principal
        </text>
        {model.lanes.map((lane) => {
          const { d, endX, endY } = lanePath(lane)
          const color = laneColor(lane.outcome)
          const dashed = lane.outcome === 'conflict'
          return (
            <g key={lane.agentId} data-testid="wt-lane" data-outcome={lane.outcome}>
              <path
                d={d}
                stroke={color}
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray={dashed ? '6 5' : undefined}
              />
              <circle cx={endX} cy={endY} r={lane.endOffset == null ? 6 : 7} fill={color} />
              <text
                x={PAD + lane.startOffset * (VW - PAD * 2) + 30}
                y={LANE_Y + 22}
                fill="var(--wt-muted)"
                fontSize={12}
              >
                {lane.agentName} · {lane.fileCount} fichier{lane.fileCount > 1 ? 's' : ''}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="wt-legend">
        <span><i className="wt-lg" style={{ background: 'var(--wt-text)' }} />ton code principal</span>
        <span><i className="wt-lg" style={{ background: 'var(--wt-accent)' }} />une copie en cours</span>
        <span><i className="wt-lg" style={{ background: 'var(--wt-ok)' }} />revenu tout seul</span>
        <span><i className="wt-lg" style={{ background: 'var(--wt-warn)' }} />Autowin te demande</span>
      </div>
    </div>
  )
}

function FileChips({ files }: { files: JournalEntry['files'] }): React.JSX.Element | null {
  if (files.length === 0) return null
  return (
    <div className="wt-files">
      {files.map((f) => (
        <span key={f.path} className={`wt-chip wt-chip-${f.kind}`}>
          {f.kind === 'add' ? '+' : f.kind === 'del' ? '−' : '~'} {f.path}
        </span>
      ))}
    </div>
  )
}

function JournalRow({
  entry,
  onResolveConflict
}: {
  entry: JournalEntry
  onResolveConflict?: (agentId: string) => void
}): React.JSX.Element {
  return (
    <div className={`wt-jrow wt-jrow-${entry.kind}`} data-testid="wt-jrow">
      <span className={`wt-jnode wt-jnode-${entry.kind}`} aria-hidden />
      <div className="wt-jcard">
        <div className="wt-jmsg">{entry.message}</div>
        <FileChips files={entry.files} />
        {entry.kind === 'merged' && (
          <span className="wt-badge wt-badge-merged">✓ Fusionné tout seul · copie rangée</span>
        )}
        {entry.kind === 'conflict' && (
          <div className="wt-conflict-row">
            <span className="wt-badge wt-badge-conflict">
              ⚠ À toi de trancher{entry.conflictFile ? ` · ${entry.conflictFile}` : ''}
            </span>
            <button
              type="button"
              className="wt-btn btn btn-sm"
              onClick={() => onResolveConflict?.(entry.agentId)}
            >
              Voir les deux versions →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export function WorktreeActivityView({
  agents,
  nowMs,
  onResolveConflict,
  className
}: {
  agents: WorktreeAgentActivity[]
  nowMs?: number
  onResolveConflict?: (agentId: string) => void
  className?: string
}): React.JSX.Element {
  const model = buildWorktreeActivity(agents, nowMs)
  return (
    <div className={`wt-view ${className ?? ''}`} data-testid="wt-view">
      <header className="wt-head">
        <span className="wt-title">Activité worktree</span>
        <span className="wt-sub">
          {model.agentsTotal} copie{model.agentsTotal > 1 ? 's' : ''}
          {model.needsAttention > 0
            ? ` · ${model.needsAttention} attend${model.needsAttention > 1 ? 'ent' : ''} ta décision`
            : ' · tout se range tout seul'}
        </span>
      </header>
      {model.agentsTotal === 0 ? (
        <div className="wt-empty">Aucune copie en cours. Les agents travaillent chacun à part ; leur activité s’affichera ici.</div>
      ) : (
        <>
          <Frieze model={model} />
          <div className="wt-journal">
            {model.journal.map((entry) => (
              <JournalRow
                key={`${entry.agentId}-${entry.kind}`}
                entry={entry}
                onResolveConflict={onResolveConflict}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
