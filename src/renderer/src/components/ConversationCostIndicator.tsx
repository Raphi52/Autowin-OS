import { useCallback, useEffect, useState } from 'react'
import {
  callsLabel,
  formatDuration,
  costRowLabel,
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

/**
 * « cache 0 % » se lit comme « rien n'a servi » alors que le premier appel ÉCRIT le cache que les
 * suivants reliront. La bulle d'aide expose ce volume ; le pourcentage, lui, reste une vraie part
 * RELUE — on ne le gonfle pas d'une écriture.
 */
function cacheWriteHint(cacheWriteTokens: number | undefined): string {
  if (!cacheWriteTokens || cacheWriteTokens <= 0) return ''
  const volume =
    cacheWriteTokens >= 1_000_000
      ? `${(cacheWriteTokens / 1_000_000).toFixed(1)}M`
      : cacheWriteTokens >= 1_000
        ? `${Math.round(cacheWriteTokens / 1_000)}k`
        : `${Math.round(cacheWriteTokens)}`
  return ` (dont ${volume} tokens écrits en cache)`
}

export function ConversationCostIndicator({
  conversationId,
  busy
}: Props): React.JSX.Element | null {
  const [rows, setRows] = useState<CostRow[]>([])
  const [openConversationId, setOpenConversationId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  /**
   * Échec du dernier refresh MANUEL (clic « Actualiser ») uniquement. Le refresh AUTOMATIQUE reste
   * silencieux à dessein (un journal illisible ne doit pas casser le composeur), mais une action
   * explicite qui échoue sans rien afficher faisait croire à un total à jour alors qu'il est périmé.
   */
  const [manualError, setManualError] = useState(false)

  const refresh = useCallback(
    async (manual = false) => {
      if (!conversationId || !window.api?.costBreakdown) return
      setLoading(true)
      if (manual) setManualError(false)
      try {
        const result = (await window.api.costBreakdown('actor', conversationId)) as
          CostRow[] | undefined
        setRows(Array.isArray(result) ? result : [])
        setManualError(false)
      } catch {
        // Un journal illisible ne doit pas casser le composeur : on garde le dernier total connu.
        if (manual) setManualError(true)
      } finally {
        setLoading(false)
      }
    },
    [conversationId]
  )

  // Au changement de conversation, et à la FIN d'un tour (busy repasse à false) : c'est le moment où
  // le journal contient la dépense du tour.
  useEffect(() => {
    if (busy) return
    // Chargement asynchrone déclenché par l'état externe du journal, pas état dérivé du rendu.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refresh()
  }, [refresh, busy])

  const open = openConversationId === conversationId
  const summary = summarizeConversationCost(rows)
  // Rien dépensé = rien à dire. Afficher « 0 $ » laisserait croire à une mesure là où il n'y a
  // qu'un journal vide.
  if (summary.calls <= 0) return null
  const detail = spendingRows(rows)
  const totalDuration = formatDuration(summary.durationMs)

  return (
    <div className="conv-cost" data-testid="conversation-cost">
      <button
        type="button"
        className={`conv-cost-btn${summary.rewritingContext ? ' warn' : ''}`}
        data-testid="conversation-cost-total"
        aria-expanded={open}
        onClick={() =>
          setOpenConversationId((id) => (id === conversationId ? null : (conversationId ?? null)))
        }
        title={
          summary.rewritingContext
            ? `${callsLabel(summary.calls)} · cache ${Math.round(summary.cacheHitRatio * 100)} %${cacheWriteHint(summary.cacheWriteTokens)} — le contexte est réécrit au lieu d’être relu`
            : `${callsLabel(summary.calls)} · cache ${Math.round(summary.cacheHitRatio * 100)} %${cacheWriteHint(summary.cacheWriteTokens)} · cliquer pour le détail`
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
              onClick={() => void refresh(true)}
              disabled={loading}
            >
              {loading ? '…' : 'Actualiser'}
            </button>
          </div>
          {manualError && (
            <p className="conv-cost-warn" role="alert" data-testid="conversation-cost-error">
              L’actualisation a échoué (journal des coûts illisible) — le total affiché peut être
              périmé.
            </p>
          )}
          {summary.rewritingContext && (
            <p className="conv-cost-warn" data-testid="conversation-cost-warning">
              Le contexte est réécrit à chaque appel au lieu d’être relu depuis le cache — c’est ce
              qui fait grimper la facture.
            </p>
          )}
          <ul className="conv-cost-rows">
            {detail.map((row) => (
              <li key={row.key} data-testid={`conversation-cost-row-${row.key}`}>
                <span className="conv-cost-key">{row.key}</span>
                <span className="conv-cost-bar" aria-hidden="true">
                  <span style={{ width: `${sharePercent(row, summary.totalUsd)}%` }} />
                </span>
                <span className="conv-cost-amount">{costRowLabel(row)}</span>
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
            Mesuré sur les journaux d’appels de cette conversation, sous-agents inclus. « — » =
            durée non enregistrée par la source, pas une opération instantanée.
          </p>
        </div>
      )}
    </div>
  )
}
