import { useCallback, useEffect, useState } from 'react'
import {
  callsLabel,
  formatDuration,
  formatUsd,
  sharePercent,
  spendingRows,
  summarizeConversationCost,
  timeSharePercent,
  type CostRow
} from './conversation-cost'
import './ConversationCostIndicator.css'

/**
 * Ce que la conversation a coûté, à côté du composeur — et le détail par acteur au clic.
 *
 * Le canal `os:costBreakdown` réconciliait déjà les deux journaux et personne ne l'appelait. Il a
 * fallu parser 114 fichiers .jsonl à la main pour découvrir 26,65 $/h : ce chiffre doit être à l'écran.
 *
 * HONNÊTE sur ce qu'il montre : rien tant que rien n'a été dépensé (pas de « 0 $ » qui ferait croire à
 * une mesure alors que le journal est simplement vide), et le rafraîchissement est explicite — la
 * dépense d'un tour n'est lisible qu'une fois le tour fini.
 */
interface Props {
  conversationId?: string
  /** Passe à false à la fin d'un tour → c'est là que la dépense devient lisible. */
  busy?: boolean
}

export function ConversationCostIndicator({ conversationId, busy }: Props): React.JSX.Element | null {
  const [rows, setRows] = useState<CostRow[]>([])
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!conversationId || !window.api?.costBreakdown) return
    setLoading(true)
    try {
      const result = (await window.api.costBreakdown('actor', conversationId)) as CostRow[] | undefined
      setRows(Array.isArray(result) ? result : [])
    } catch {
      // Un journal illisible ne doit pas casser le composeur : on garde le dernier total connu.
    } finally {
      setLoading(false)
    }
  }, [conversationId])

  // Au changement de conversation, et à la FIN d'un tour (busy repasse à false) : c'est le moment où
  // le journal contient la dépense du tour.
  useEffect(() => {
    if (busy) return
    void refresh()
  }, [refresh, busy])

  useEffect(() => {
    setOpen(false)
  }, [conversationId])

  const summary = summarizeConversationCost(rows)
  // Rien dépensé = rien à dire. Afficher « 0 $ » laisserait croire à une mesure là où il n'y a
  // qu'un journal vide.
  if (summary.totalUsd <= 0) return null
  const detail = spendingRows(rows)
  const totalDuration = formatDuration(summary.durationMs)

  return (
    <div className="conv-cost" data-testid="conversation-cost">
      <button
        type="button"
        className={`conv-cost-btn${summary.rewritingContext ? ' warn' : ''}`}
        data-testid="conversation-cost-total"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        title={
          summary.rewritingContext
            ? `${callsLabel(summary.calls)} · cache ${Math.round(summary.cacheHitRatio * 100)} % — le contexte est réécrit au lieu d’être relu`
            : `${callsLabel(summary.calls)} · cache ${Math.round(summary.cacheHitRatio * 100)} % · cliquer pour le détail`
        }
      >
        {summary.label}
        {summary.rewritingContext ? <span className="conv-cost-flag"> ⚠</span> : null}
      </button>
      {open && (
        <div className="conv-cost-panel" data-testid="conversation-cost-panel">
          <div className="conv-cost-head">
            <span>
              {callsLabel(summary.calls)} · cache {Math.round(summary.cacheHitRatio * 100)} %
              {totalDuration ? ` · ${totalDuration}` : ''}
            </span>
            <button
              type="button"
              className="conv-cost-refresh"
              onClick={() => void refresh()}
              disabled={loading}
            >
              {loading ? '…' : 'Actualiser'}
            </button>
          </div>
          {summary.rewritingContext && (
            <p className="conv-cost-warn" data-testid="conversation-cost-warning">
              Le contexte est réécrit à chaque appel au lieu d’être relu depuis le cache — c’est ce qui
              fait grimper la facture.
            </p>
          )}
          <ul className="conv-cost-rows">
            {detail.map((row) => (
              <li key={row.key} data-testid={`conversation-cost-row-${row.key}`}>
                <span className="conv-cost-key">{row.key}</span>
                <span className="conv-cost-bar" aria-hidden="true">
                  <span style={{ width: `${sharePercent(row, summary.totalUsd)}%` }} />
                </span>
                <span className="conv-cost-amount">{formatUsd(row.costUsd)}</span>
                {/* Le poste le plus LENT n'est pas forcement le plus cher : les deux sont montres. */}
                <span className="conv-cost-time" data-testid={`conversation-time-${row.key}`}>
                  {formatDuration(row.durationMs ?? 0) ?? '—'}
                  {summary.durationMs > 0 && row.durationMs
                    ? ` · ${timeSharePercent(row, summary.durationMs)} %`
                    : ''}
                </span>
              </li>
            ))}
          </ul>
          <p className="conv-cost-note">
            Mesuré sur les journaux d’appels de cette conversation, sous-agents inclus. « — » = durée
            non enregistrée par la source, pas une opération instantanée.
          </p>
        </div>
      )}
    </div>
  )
}
