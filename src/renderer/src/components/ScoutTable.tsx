import React from 'react'
import type { Band, ScoutRow } from './scout-table'
import './ScoutTable.css'

/**
 * Rend un retour scout comme un VRAI tableau à pastilles (design "Ledger dense", façon Claude Code)
 * au lieu du tableau markdown brut. Un clic sur une ligne envoie « frame le candidat #N » (onPick).
 */
function Dot({ band }: { band: Band }): React.JSX.Element {
  const cls = band ? ` st-${band}` : ''
  return <span className={`st-dot${cls}`} aria-hidden="true" />
}

export function ScoutTable({
  rows,
  onPick
}: {
  rows: ScoutRow[]
  onPick?: (prompt: string) => void
}): React.JSX.Element {
  return (
    <div className="st-wrap" data-testid="scout-table">
      <table className="st-ledger">
        <thead>
          <tr>
            <th>#</th><th>Imp.</th><th>Eff.</th><th>Type</th>
            <th>Manquement</th><th>Pourquoi</th><th>1er pas</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.num}
              data-testid="st-row"
              className={onPick ? 'st-clickable' : undefined}
              onClick={onPick ? () => onPick(`frame le candidat #${r.num}`) : undefined}
              title={onPick ? `Framer le candidat #${r.num}` : undefined}
            >
              <td className="st-num">{r.num}</td>
              <td className="st-celldot"><Dot band={r.impact} /></td>
              <td className="st-celldot"><Dot band={r.effort} /></td>
              <td>
                {r.type && (
                  <span className={`st-type st-type-${r.type}`}>
                    {r.type === 'new' ? '🆕 new' : '🔧 fix'}
                  </span>
                )}
              </td>
              <td className="st-what">{r.what}</td>
              <td className="st-why">{r.why}</td>
              <td className="st-how">{r.how}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
