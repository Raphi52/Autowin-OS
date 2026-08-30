import { useEffect, useMemo, useState } from 'react'
import type { OrchestratorModelOption } from './chat-view-model'
import { effortLabel, sortEfforts } from './model-effort-labels'
import { recommendedEffort } from './model-effort-recommendations'
import { shortModelLabel } from './model-display-label'

/**
 * Une ligne de la matrice : un modèle du catalogue et les crans d'effort qu'il expose.
 * `blocked` = provider injoignable (expiré / absent / standby) : la ligne reste visible,
 * mais aucun cran n'est cliquable — le refus se voit AU MOMENT du choix.
 */
export interface ModelEffortRow {
  key: string
  label: string
  model: string
  option: OrchestratorModelOption
  efforts: string[]
  blocked?: boolean
  blockedReason?: string
}

/**
 * Matrice MODEL × EFFORT : une ligne par modèle, un slider discret de crans d'effort.
 * Un seul couple (modèle, effort) est actif ; les autres lignes gardent un point discret
 * sur leur cran MÉMORISÉ, et le survol montre le cran visé avant de cliquer.
 */
export function ModelEffortMatrix({
  title,
  rows,
  activeKey,
  activeEffort,
  variant = 'overlay',
  onSelect,
  onClose
}: {
  title?: string
  rows: ModelEffortRow[]
  /** `${provider}:${model}` de la ligne active, ou null si aucune. */
  activeKey: string | null
  activeEffort?: string
  /**
   * `overlay` = modale (dialogue + fond cliquable + Échap).
   * `inline` = la matrice vit DANS la popup du chat : ni fond, ni en-tête, ni Échap propre —
   * la popup hôte gère sa propre fermeture.
   */
  variant?: 'overlay' | 'inline'
  onSelect: (option: OrchestratorModelOption) => void
  onClose: () => void
}): React.JSX.Element {
  const [preview, setPreview] = useState<{ key: string; effort: string } | null>(null)
  /**
   * Les échelles d'effort ne sont PAS comparables entre fournisseurs : `xhigh` d'OpenAI
   * n'existe pas chez Claude. On groupe donc par fournisseur, et chaque groupe porte
   * SA propre échelle = union ordonnée des efforts de SES modèles.
   */
  const groups = useMemo(() => {
    const byProvider = new Map<string, ModelEffortRow[]>()
    for (const row of rows) {
      const provider = row.option.provider
      const bucket = byProvider.get(provider)
      if (bucket) bucket.push(row)
      else byProvider.set(provider, [row])
    }
    return [...byProvider.entries()].map(([provider, groupRows]) => ({
      provider,
      rows: groupRows,
      columns: sortEfforts([...new Set(groupRows.flatMap((row) => row.efforts))])
    }))
  }, [rows])
  /** Cran mémorisé par ligne : le cran actif pour la ligne active, sinon le défaut du catalogue. */
  const memorized = useMemo(() => {
    const table: Record<string, string> = {}
    for (const row of rows) {
      const efforts = sortEfforts(row.efforts)
      if (efforts.length === 0) continue
      const fromCatalog = row.option.defaultReasoningEffort
      table[row.key] =
        row.key === activeKey && activeEffort && efforts.includes(activeEffort)
          ? activeEffort
          : fromCatalog && efforts.includes(fromCatalog)
            ? fromCatalog
            : efforts[Math.floor((efforts.length - 1) / 2)]
    }
    return table
  }, [rows, activeKey, activeEffort])

  useEffect(() => {
    if (variant === 'inline') return
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', closeOnEscape)
    return () => document.removeEventListener('keydown', closeOnEscape)
  }, [onClose, variant])

  const previewRow = preview ? rows.find((row) => row.key === preview.key) : undefined
  const inline = variant === 'inline'

  const corps = (
    <div
      className={inline ? 'effort-matrix is-inline' : 'effort-matrix'}
      data-testid={inline ? 'effort-matrix' : undefined}
      aria-label={inline ? (title ?? 'Matrice modèle × effort') : undefined}
    >
      {!inline && (
        <header>
          <strong>{title ?? 'MODEL × EFFORT'}</strong>
          <button type="button" aria-label="Fermer la matrice" onClick={onClose}>
            ✕
          </button>
        </header>
      )}
      {groups.map((group) => (
        <section
          key={group.provider}
          className="effort-matrix-group"
          data-provider={group.provider}
          aria-label={`Échelle d’effort ${group.provider}`}
        >
          <h4 className="effort-matrix-group-title">{group.provider}</h4>
          <div className="effort-matrix-columns" aria-hidden="true">
            <span />
            {group.columns.map((effort) => (
              <span key={effort}>{effort}</span>
            ))}
          </div>
          {group.rows.map((row) => {
            const efforts = sortEfforts(row.efforts)
            const isActiveRow = row.key === activeKey
            const held = memorized[row.key]
            const shown =
              preview && preview.key === row.key && efforts.includes(preview.effort)
                ? preview.effort
                : held
            const filledUntil = shown ? efforts.indexOf(shown) : -1
            // Pastille verte : cran conseillé pour CE modèle, s'il existe vraiment dans son catalogue.
            const conseille = recommendedEffort(row.option.provider, row.model)
            const cranConseille = conseille && efforts.includes(conseille) ? conseille : undefined
            return (
              <div
                key={row.key}
                className={`effort-matrix-row${isActiveRow ? ' is-active' : ''}${row.blocked ? ' is-blocked' : ''}`}
                data-row={row.key}
                data-shown={shown}
                role="radiogroup"
                aria-label={`Effort pour ${row.label}`}
              >
                <span className="effort-matrix-name">
                  <strong>{shortModelLabel(row.label, row.option.provider)}</strong>
                  <small>{row.model}</small>
                </span>
                <span className="effort-matrix-track">
                  {group.columns.map((effort) => {
                    const index = efforts.indexOf(effort)
                    if (index === -1) {
                      return (
                        <span key={effort} className="effort-cran is-absent" aria-hidden="true" />
                      )
                    }
                    const selected = shown === effort
                    const filled = filledUntil >= 0 && index <= filledUntil
                    // Le point SÉLECTIONNÉ (gros et brillant) est prioritaire : la pastille verte de
                    // recommandation s'efface sous lui plutôt que de coexister avec deux signaux.
                    const recommande = cranConseille === effort && !selected
                    return (
                      <button
                        key={effort}
                        type="button"
                        role="radio"
                        data-effort={effort}
                        aria-checked={isActiveRow && held === effort}
                        aria-disabled={row.blocked || undefined}
                        title={
                          row.blocked
                            ? row.blockedReason
                            : recommande
                              ? `${effortLabel(effort)} — effort recommandé pour ${row.label}`
                              : effortLabel(effort)
                        }
                        className={`effort-cran${selected ? ' is-selected' : ''}${filled ? ' is-filled' : ''}${isActiveRow ? ' is-live' : ' is-memorized'}${recommande ? ' is-recommended' : ''}`}
                        onMouseEnter={() => setPreview({ key: row.key, effort })}
                        onFocus={() => setPreview({ key: row.key, effort })}
                        onMouseLeave={() => setPreview(null)}
                        onBlur={() => setPreview(null)}
                        onClick={() => {
                          if (row.blocked) return
                          onSelect({ ...row.option, reasoningEffort: effort })
                          onClose()
                        }}
                      >
                        <i aria-hidden="true" />
                        <em>{effortLabel(effort)}</em>
                      </button>
                    )
                  })}
                </span>
              </div>
            )
          })}
        </section>
      ))}
      <footer role="status" aria-live="polite">
        {preview && previewRow
          ? `${previewRow.label} · ${effortLabel(preview.effort)}`
          : activeKey && activeEffort
            ? `Actif : ${rows.find((row) => row.key === activeKey)?.label ?? activeKey} · ${effortLabel(activeEffort)}`
            : 'Choisis un modèle et son cran d’effort.'}
      </footer>
    </div>
  )

  if (inline) return corps

  return (
    <div
      className="effort-matrix-overlay"
      data-testid="effort-matrix"
      role="dialog"
      aria-modal="true"
      aria-label={title ?? 'Matrice modèle × effort'}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      {corps}
    </div>
  )
}
