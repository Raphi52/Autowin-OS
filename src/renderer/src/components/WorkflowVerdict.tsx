import { useState, type JSX } from 'react'
import './WorkflowVerdict.css'

/**
 * Le verdict d'une confrontation : qui a produit le meilleur travail, pour combien.
 *
 * La tentation d'un tableau comme celui-ci est d'afficher un chiffre partout, quitte à écrire 0,00 $
 * là où on ne sait pas. Ce composant refuse : un coût inconnu s'affiche « — », et la réserve qui
 * l'accompagne (run non vert, appels non tarifés) est visible sur la ligne, pas enterrée en note.
 */

export interface VerdictRow {
  profileId: string
  profileName: string
  green: boolean
  comparableCostUsd: number | null
  totalTokens?: number
  durationMs?: number
  caveat?: string
  proofStatus?: 'passed' | 'failed' | 'unknown'
  checksPassed?: number
  checksFailed?: number
  retainedWorkspace?: { runId: string; path: string; baseSha?: string; files: string[] }
}

export interface WorkflowVerdictProps {
  objective: string
  rows: readonly VerdictRow[]
  recommendedProfileId?: string
  rationale: string
  /** Workflows non lancés (interruption) — annoncés, jamais tus. */
  skipped?: readonly string[]
}

function cost(value: number | null): string {
  return value === null ? '—' : `${value.toFixed(2)} $`
}

function duration(ms?: number): string {
  if (typeof ms !== 'number') return '—'
  return ms < 60_000 ? `${Math.round(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`
}

export function WorkflowVerdict({
  objective,
  rows,
  recommendedProfileId,
  rationale,
  skipped
}: WorkflowVerdictProps): JSX.Element {
  const [discarded, setDiscarded] = useState<Set<string>>(() => new Set())
  const [discardError, setDiscardError] = useState<Record<string, string>>({})

  const discard = async (runId: string): Promise<void> => {
    if (!window.confirm('Supprimer définitivement ce bureau isolé ?')) return
    try {
      const removed = await window.api.discardHeldWorktree(runId)
      if (!removed) throw new Error('Ce bureau n’est plus supprimable.')
      setDiscarded((current) => new Set(current).add(runId))
      setDiscardError((current) => {
        const next = { ...current }
        delete next[runId]
        return next
      })
    } catch (error) {
      setDiscardError((current) => ({
        ...current,
        [runId]: error instanceof Error ? error.message : String(error)
      }))
    }
  }

  return (
    <section className="workflow-verdict" data-testid="workflow-verdict">
      <h3 className="workflow-verdict-title">Verdict — « {objective} »</h3>
      <div className="workflow-verdict-table-scroll" tabIndex={0} aria-label="Résultats comparés">
        <table className="workflow-verdict-table">
          <thead>
            <tr>
              <th>Workflow</th>
              <th>Aboutit</th>
              <th>Preuves</th>
              <th>Coût</th>
              <th>Tokens</th>
              <th>Durée</th>
              <th>Bureau</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.profileId || 'courant'}
                className={row.profileId === recommendedProfileId ? 'is-recommended' : undefined}
                data-testid={`verdict-row-${row.profileId || 'courant'}`}
              >
                <th scope="row">
                  {row.profileName}
                  {row.profileId === recommendedProfileId && (
                    <span className="workflow-verdict-badge">recommandé</span>
                  )}
                  {/* La réserve vit sur la ligne : une note de bas de tableau ne se lit pas. */}
                  {row.caveat && <span className="workflow-verdict-caveat">{row.caveat}</span>}
                </th>
                <td>{row.green ? 'oui' : 'non'}</td>
                <td>{describeProof(row)}</td>
                <td>{cost(row.comparableCostUsd)}</td>
                <td>
                  {typeof row.totalTokens === 'number'
                    ? row.totalTokens.toLocaleString('fr-FR')
                    : '—'}
                </td>
                <td>{duration(row.durationMs)}</td>
                <td>
                  {row.retainedWorkspace &&
                    (discarded.has(row.retainedWorkspace.runId) ? (
                      <span>Bureau supprimé</span>
                    ) : (
                      <span className="workflow-verdict-workspace-actions">
                        <button
                          type="button"
                          className="btn btn-ghost"
                          onClick={() => void window.api.openFolder(row.retainedWorkspace!.path)}
                        >
                          Ouvrir
                        </button>
                        <button
                          type="button"
                          className="btn btn-ghost workflow-verdict-discard"
                          onClick={() => void discard(row.retainedWorkspace!.runId)}
                        >
                          Supprimer
                        </button>
                        {discardError[row.retainedWorkspace.runId] && (
                          <small role="alert">{discardError[row.retainedWorkspace.runId]}</small>
                        )}
                      </span>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="workflow-verdict-rationale">{rationale}</p>
      {skipped && skipped.length > 0 && (
        <p className="workflow-verdict-skipped">
          Non lancés : {skipped.join(', ')}. La comparaison ne porte que sur les workflows exécutés.
        </p>
      )}
    </section>
  )
}

function describeProof(row: VerdictRow): string {
  if (row.proofStatus === 'passed') return `${row.checksPassed ?? 0} verte(s)`
  if (row.proofStatus === 'failed') return `${row.checksFailed ?? 0} rouge(s)`
  return 'inconnue'
}
