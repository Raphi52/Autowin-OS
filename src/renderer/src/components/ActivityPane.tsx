import { useEffect, useState } from 'react'

/**
 * Activité de la CONVERSATION courante — chaque étape facturée (tour de chat de l'agent,
 * sous-étape d'orchestration) avec son coût en tokens. Scopé à la conversation active :
 * plus de sessions globales, plus d'habitudes ni de ledger in-app.
 */

type ConvActivityEntry = {
  ts: string
  kind: 'chat' | 'exec' | 'judge' | 'gate' | string
  label: string
  provider?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  text?: string
}

const KIND_META: Record<string, { icon: string; label: string }> = {
  chat: { icon: '💬', label: 'agent' },
  exec: { icon: '🤖', label: 'sous-agent' },
  judge: { icon: '⚖️', label: 'juge' },
  gate: { icon: '🚦', label: 'gate' }
}

const timeFmt = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
const nf = new Intl.NumberFormat('fr-FR')
const tokensOf = (e: ConvActivityEntry): number => (e.inputTokens ?? 0) + (e.outputTokens ?? 0)

export function ActivityPane({ convId }: { convId: string | null }): React.JSX.Element {
  const [entries, setEntries] = useState<ConvActivityEntry[]>([])
  const [loading, setLoading] = useState(false)

  async function refresh(): Promise<void> {
    if (!convId) {
      setEntries([])
      return
    }
    setLoading(true)
    try {
      setEntries((await window.api.conversationActivity(convId)) as ConvActivityEntry[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
    // Les orchestrations/tours de chat rafraîchissent l'activité de la conversation.
    const off = window.api.onAppEvent((e) => {
      if (
        (e.type === 'refresh' && (e.scope === 'workflows' || e.scope === 'chat')) ||
        e.type === 'orchestrate-end'
      ) {
        refresh()
      }
    })
    return off
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [convId])

  if (!convId) {
    return (
      <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
        Sélectionne une conversation pour voir son activité (étapes + coût en tokens).
      </div>
    )
  }

  const totalTokens = entries.reduce((s, e) => s + tokensOf(e), 0)
  const totalCost = entries.reduce((s, e) => s + (e.costUsd ?? 0), 0)

  return (
    <div className="col grow" style={{ gap: 'var(--s2)', minHeight: 0 }}>
      {/* Récap coût de la conversation */}
      <div className="row gap2 wrap" style={{ fontSize: 11 }}>
        <span className="badge">{entries.length} étapes</span>
        <span className="badge">{nf.format(totalTokens)} tokens</span>
        {totalCost > 0 && <span className="badge">{totalCost.toFixed(4)} $</span>}
      </div>

      <div className="scroll-y col grow" style={{ gap: 4, minHeight: 0 }}>
        {loading && (
          <div className="c-faint" style={{ fontSize: 12 }}>
            <span className="spinner" /> chargement…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
            Aucune étape pour l'instant — écris un message ou lance une orchestration.
          </div>
        )}
        {entries.map((e, i) => {
          const meta = KIND_META[e.kind] ?? { icon: '•', label: e.kind }
          const toks = tokensOf(e)
          return (
            <div key={i} className="act-step">
              <div className="row gap2" style={{ fontSize: 11 }}>
                <span>{meta.icon}</span>
                <span className="c-dim" style={{ fontWeight: 600 }}>
                  {meta.label}
                </span>
                {e.provider && <span className="mono c-accent">{e.provider}</span>}
                <span className="c-faint tnum">{timeFmt(e.ts)}</span>
                <span className="tnum act-cost" style={{ marginLeft: 'auto' }}>
                  {toks > 0 ? `${nf.format(toks)} tok` : '—'}
                  {typeof e.costUsd === 'number' && e.costUsd > 0 && (
                    <span className="c-faint"> · {e.costUsd.toFixed(4)} $</span>
                  )}
                </span>
              </div>
              {(e.inputTokens != null || e.outputTokens != null) && toks > 0 && (
                <div className="c-faint tnum" style={{ fontSize: 10, marginTop: 1 }}>
                  ↓ {nf.format(e.inputTokens ?? 0)} in · ↑ {nf.format(e.outputTokens ?? 0)} out
                </div>
              )}
              {e.label && (
                <div className="act-step-label c-faint" title={e.label}>
                  {e.label}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
