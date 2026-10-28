import { Fragment, useState } from 'react'
import { parseUnifiedDiff } from '../../../shared/git-read'
import {
  cleEmplacement,
  repererLigne,
  type CommentaireRelecture,
  type RepereLigne
} from '../../../shared/relecture-diff'
import { useTextesWorktreesEtBureaux } from '../textes-ecrans/worktrees-et-bureaux'
import './DiffView.css'

/**
 * Rendu d'un diff unifié : lignes colorées (+ vert / − rouge / hunk / contexte) avec une GOUTTIÈRE
 * de numéros de ligne (avant / après) — sans elle on voit qu'une ligne a changé, pas LAQUELLE.
 * Colonne gauche = numéro dans le fichier d'origine, droite = dans le fichier modifié.
 *
 * RELECTURE (2026-09-28, voir `shared/relecture-diff.ts`) : avec `onAjouter`, chaque ligne
 * numérotée porte un bouton « + » dans sa gouttière qui ouvre une zone de commentaire ; les
 * commentaires déjà posés s'affichent sous leur ligne. Sans `onAjouter`, le rendu reste en lecture
 * seule, exactement comme avant (vue des conflits).
 */
export function DiffView({
  diff,
  commentaires = [],
  onAjouter,
  onRetirer
}: {
  diff: string
  /** Commentaires de CE fichier, rattachés à leur ligne par côté + numéro. */
  commentaires?: readonly CommentaireRelecture[]
  onAjouter?: (repere: RepereLigne, texte: string) => void
  onRetirer?: (id: string) => void
}): React.JSX.Element {
  const { t } = useTextesWorktreesEtBureaux()
  const lines = parseUnifiedDiff(diff)
  /**
   * Emplacement (côté + numéro) dont la zone de commentaire est ouverte — pas l'index dans la
   * liste. Quand le diff est relu pendant le tour, l'index glisse dès que la liste s'allonge plus
   * haut (nouveau bloc, ligne retirée) ; le numéro, lui, ne bouge que si le fichier gagne ou perd
   * des lignes au-dessus.
   */
  const [enEdition, setEnEdition] = useState<string | null>(null)
  const [brouillon, setBrouillon] = useState('')
  if (!lines.length) return <div className="diff-empty">{t('diff.vide')}</div>

  const parEmplacement = new Map<string, CommentaireRelecture[]>()
  for (const c of commentaires) {
    const cle = cleEmplacement('', c.cote, c.ligne)
    parEmplacement.set(cle, [...(parEmplacement.get(cle) ?? []), c])
  }
  /**
   * Chiffres du plus grand numéro de ligne, avant comme après (2 au moins). La gouttière compacte
   * du panneau Détails (DiffView.css) se cale dessus : la colonne garde la place exacte de ses
   * numéros, et rend le reste au code.
   */
  const chiffres = String(
    lines.reduce((max, l) => Math.max(max, l.oldLine ?? 0, l.newLine ?? 0), 10)
  ).length
  const fermer = (): void => {
    setEnEdition(null)
    setBrouillon('')
  }
  const valider = (repere: RepereLigne): void => {
    const texte = brouillon.trim()
    if (!texte || !onAjouter) return
    onAjouter(repere, texte)
    fermer()
  }

  return (
    <div
      className="diff-view"
      data-testid="diff-view"
      style={{ '--diff-chiffres': chiffres } as React.CSSProperties}
    >
      {lines.map((l, i) => {
        const repere = onAjouter ? repererLigne(lines, i) : null
        const emplacement = repere ? cleEmplacement('', repere.cote, repere.ligne) : null
        const poses = emplacement ? (parEmplacement.get(emplacement) ?? []) : []
        return (
          <Fragment key={i}>
            <div className={`diff-line diff-${l.kind}${poses.length ? ' diff-commentee' : ''}`}>
              <span className="diff-gutter">
                {repere && (
                  <button
                    type="button"
                    className="diff-commenter"
                    data-testid="diff-commenter"
                    title={t('diff.commenter.titre', { ligne: repere.ligne })}
                    aria-label={t('diff.commenter.aria', { ligne: repere.ligne })}
                    onClick={(event) => {
                      event.stopPropagation()
                      setEnEdition(emplacement)
                      setBrouillon('')
                    }}
                  >
                    +
                  </button>
                )}
                <i className="diff-lineno" aria-hidden="true">
                  {l.oldLine ?? ''}
                </i>
                <i className="diff-lineno" aria-hidden="true">
                  {l.newLine ?? ''}
                </i>
              </span>
              <code className="diff-code">{l.text || ' '}</code>
            </div>
            {poses.map((c) => (
              <div className="diff-comment" data-testid="diff-comment" key={c.id}>
                <span className="diff-comment-texte">{c.texte}</span>
                {onRetirer && (
                  <button
                    type="button"
                    className="diff-comment-retirer"
                    data-testid="diff-comment-retirer"
                    title={t('diff.retirer.titre')}
                    aria-label={t('diff.retirer.aria')}
                    onClick={(event) => {
                      event.stopPropagation()
                      onRetirer(c.id)
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
            ))}
            {repere && emplacement !== null && enEdition === emplacement && (
              <div className="diff-editeur" data-testid="diff-editeur">
                <textarea
                  className="diff-editeur-texte"
                  data-testid="diff-editeur-texte"
                  autoFocus
                  rows={2}
                  value={brouillon}
                  placeholder={t('diff.editeur.aide', { ligne: repere.ligne })}
                  onChange={(event) => setBrouillon(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      fermer()
                    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                      event.preventDefault()
                      valider(repere)
                    }
                  }}
                />
                <div className="diff-editeur-actions">
                  <button
                    type="button"
                    className="sc-btn"
                    data-testid="diff-editeur-ajouter"
                    disabled={!brouillon.trim()}
                    onClick={() => valider(repere)}
                  >
                    {t('diff.editeur.ajouter')}
                  </button>
                  <button type="button" className="sc-btn" onClick={fermer}>
                    {t('commun.annuler')}
                  </button>
                </div>
              </div>
            )}
          </Fragment>
        )
      })}
    </div>
  )
}
