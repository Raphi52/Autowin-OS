import { parseUnifiedDiff } from '../../../shared/git-read'
import './DiffView.css'

/**
 * Rendu READ-ONLY d'un diff unifié : lignes colorées (+ vert / − rouge / hunk / contexte) avec une
 * GOUTTIÈRE de numéros de ligne (avant / après) — sans elle on voit qu'une ligne a changé, pas
 * LAQUELLE. Colonne gauche = numéro dans le fichier d'origine, droite = dans le fichier modifié.
 */
export function DiffView({ diff }: { diff: string }): React.JSX.Element {
  const lines = parseUnifiedDiff(diff)
  if (!lines.length) return <div className="diff-empty">Aucune différence à afficher.</div>
  return (
    <div className="diff-view" data-testid="diff-view">
      {lines.map((l, i) => (
        <div className={`diff-line diff-${l.kind}`} key={i}>
          <span className="diff-gutter" aria-hidden="true">
            <i className="diff-lineno">{l.oldLine ?? ''}</i>
            <i className="diff-lineno">{l.newLine ?? ''}</i>
          </span>
          <code className="diff-code">{l.text || ' '}</code>
        </div>
      ))}
    </div>
  )
}
