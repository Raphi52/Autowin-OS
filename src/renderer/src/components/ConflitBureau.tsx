import { DiffView } from './DiffView'
import { conflictDiffMessage } from '../../../shared/worktree-activity-model'
import type { ConflitBureau } from './useConflitBureau'
import { useTextesWorktreesEtBureaux } from '../textes-ecrans/worktrees-et-bureaux'
// Les classes `sc-*` du panneau de comparaison vivent dans cette feuille : la partager avec la vue
// Worktrees évite de dupliquer le style en même temps que le comportement.
import './SourceControlPane.css'

/** Le message de résolution et la comparaison lecture seule des deux versions. */
export function ConflitBureauPanneau({
  conflit
}: {
  conflit: ConflitBureau
}): React.JSX.Element | null {
  const { t } = useTextesWorktreesEtBureaux()
  const { conflictResolution, conflictAgentId, conflictDiff, closeConflictDiff } = conflit
  if (!conflictResolution && !conflictAgentId) return null
  return (
    <>
      {conflictResolution && (
        <div className="sc-clean" data-testid="wt-conflict-resolution" role="status">
          {conflictResolution}
        </div>
      )}
      {conflictAgentId && (
        <div className="sc-diff-wrap" data-testid="wt-conflict-diff">
          <div className="sc-diff-card">
            <div className="sc-diff-head">
              <span className="sc-diff-title">
                {conflictDiff?.available ? conflictDiff.paths.join(', ') : t('comparaison.titre')}
              </span>
              <span className="sc-diff-wrap-mode">{t('comparaison.lectureSeule')}</span>
              <button
                className="sc-btn"
                data-testid="wt-conflict-close"
                title={t('comparaison.fermer')}
                onClick={closeConflictDiff}
              >
                {t('commun.fermer')}
              </button>
            </div>
            <div className="sc-diff-content">
              {conflictDiff === null ? (
                <div className="sc-clean">{t('comparaison.preparation')}</div>
              ) : conflictDiff.available ? (
                <DiffView diff={conflictDiff.diff} />
              ) : (
                <div className="sc-clean" data-testid="wt-conflict-diff-error">
                  {conflictDiffMessage(conflictDiff.reason)}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
