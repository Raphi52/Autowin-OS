import { parseUnifiedDiff } from '../../../shared/git-read'
import './DiffView.css'

/** Rendu READ-ONLY d'un diff unifié : lignes colorées (+ vert / − rouge / hunk / contexte). */
export function DiffView({ diff }: { diff: string }): React.JSX.Element {
  const lines = parseUnifiedDiff(diff)
  if (!lines.length) return <div className="diff-empty">Aucune différence à afficher.</div>
  return (
    <pre className="diff-view" data-testid="diff-view">
      {lines.map((l, i) => (
        <div className={`diff-line diff-${l.kind}`} key={i}>
          {l.text || ' '}
        </div>
      ))}
    </pre>
  )
}
