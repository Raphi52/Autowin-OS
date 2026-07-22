import { useEffect, useRef, useState } from 'react'
import { mergeActivityEntries } from './activity-pane-model'
import { HumanJson } from './HumanJson'
import { RagTraceCard } from './RagTraceCard'

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
  model?: string
  reasoningEffort?: string
  inputTokens?: number
  outputTokens?: number
  costUsd?: number
  text?: string
  screenshots?: string[]
}

type PromptCall = {
  id: string
  ts: string
  iteration: number
  actor: string
  provider: string
  model?: string
  system?: string
  messages: Array<{ role: string; content: string }>
  response: string
  limitation: string
  usage?: { inputTokens: number; outputTokens: number; cacheReadTokens?: number }
}

type HermesTrace = {
  timestamp: string
  apiRequestId: string
  provider: string
  model: string
  messageCount: number
  toolCount: number
  boundary: 'hermes.pre_api_request' | 'hermes.request_dump'
  source: 'plugin-hook' | 'request-dump'
  conversationId?: string
  request: Record<string, unknown>
}

const KIND_META: Record<string, { icon: string; label: string }> = {
  chat: { icon: '💬', label: 'agent' },
  exec: { icon: '🤖', label: 'sous-agent' },
  judge: { icon: '⚖️', label: 'juge' },
  gate: { icon: '🚦', label: 'gate' }
}

const timeFmt = (iso: string): string =>
  new Date(iso).toLocaleTimeString('fr-FR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
const nf = new Intl.NumberFormat('fr-FR')
const tokensOf = (e: ConvActivityEntry): number => (e.inputTokens ?? 0) + (e.outputTokens ?? 0)
export function ActivityPane({ convId }: { convId: string | null }): React.JSX.Element {
  const [entries, setEntries] = useState<ConvActivityEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [promptCalls, setPromptCalls] = useState<PromptCall[]>([])
  const [hermesTraces, setHermesTraces] = useState<HermesTrace[]>([])
  const [proof, setProof] = useState<{ path: string; dataUrl: string } | null>(null)
  const [proofError, setProofError] = useState<string | null>(null)
  const refreshGenerationRef = useRef(0)

  async function openProof(path: string): Promise<void> {
    setProofError(null)
    try {
      const image = await window.api.activityImage(path)
      setProof({ path, dataUrl: image.dataUrl })
    } catch {
      setProofError(`Preuve indisponible : ${path}`)
    }
  }

  async function refresh(): Promise<void> {
    const generation = ++refreshGenerationRef.current
    if (!convId) {
      setEntries([])
      setPromptCalls([])
      setHermesTraces([])
      return
    }
    setLoading(true)
    try {
      const [activity, globalConfig, calls, hermes] = await Promise.all([
        window.api.conversationActivity(convId),
        window.api.conversationActivity('__global_prompt_config__'),
        window.api.promptCalls(convId),
        window.api.promptTraces(convId)
      ])
      if (generation !== refreshGenerationRef.current) return
      setEntries(
        mergeActivityEntries(activity as ConvActivityEntry[], globalConfig as ConvActivityEntry[])
      )
      setPromptCalls(calls as PromptCall[])
      setHermesTraces(
        (hermes as HermesTrace[])
          .filter((trace) => !trace.conversationId || trace.conversationId === convId)
          .slice(-20)
          .reverse()
      )
    } finally {
      if (generation === refreshGenerationRef.current) setLoading(false)
    }
  }

  useEffect(() => {
    // Réinitialisation intentionnelle à chaque changement de conversation avant l'abonnement aux événements.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    return () => {
      refreshGenerationRef.current += 1
      off()
    }
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

      {promptCalls.length > 0 && (
        <details className="workflow-prompt-calls">
          <summary>
            {promptCalls.length} payload{promptCalls.length > 1 ? 's' : ''} exact
            {promptCalls.length > 1 ? 's' : ''}
          </summary>
          <div className="col" style={{ gap: 6, marginTop: 6 }}>
            {promptCalls.map((call) => (
              <details key={call.id} className="prompt-envelope">
                <summary>
                  {call.actor} → {call.provider} · {call.model ?? 'modèle par défaut'} · itération{' '}
                  {call.iteration + 1}
                </summary>
                <div className="prompt-envelope-meta">
                  <span>{call.usage?.inputTokens ?? '—'} tokens in</span>
                  <span>{call.usage?.outputTokens ?? '—'} out</span>
                  <span>
                    {call.usage ? `${call.usage.cacheReadTokens ?? 0} cache` : 'usage non mesuré'}
                  </span>
                </div>
                <strong>Instructions système</strong>
                <pre>{call.system || '(aucune)'}</pre>
                <strong>Messages</strong>
                <HumanJson value={call.messages} />
                <strong>Réponse</strong>
                <pre>{call.response}</pre>
                <p className="prompt-envelope-limit">Zone opaque : {call.limitation}</p>
              </details>
            ))}
          </div>
        </details>
      )}

      {hermesTraces.length > 0 && (
        <details className="workflow-prompt-calls hermes-preflight">
          <summary>
            {hermesTraces.length} requête{hermesTraces.length > 1 ? 's' : ''} Hermes ·{' '}
            {hermesTraces.filter((trace) => trace.conversationId === convId).length} rattachée
            {hermesTraces.filter((trace) => trace.conversationId === convId).length > 1
              ? 's'
              : ''}{' '}
            · {hermesTraces.filter((trace) => !trace.conversationId).length} non rattachée
            {hermesTraces.filter((trace) => !trace.conversationId).length > 1 ? 's' : ''}
          </summary>
          <p className="prompt-envelope-limit">
            Les payloads non rattachés sont hors conversation sélectionnée · secrets masqués
          </p>
          <div className="col" style={{ gap: 6 }}>
            {hermesTraces.map((trace) => (
              <details key={`${trace.apiRequestId}:${trace.timestamp}`} className="prompt-envelope">
                <summary>
                  {trace.provider} → {trace.model} · {timeFmt(trace.timestamp)}
                </summary>
                <div className="prompt-envelope-meta">
                  <span>{trace.messageCount} messages</span>
                  <span>{trace.toolCount} outils</span>
                  <span>{trace.boundary}</span>
                  <span>{trace.source}</span>
                </div>
                <RagTraceCard request={trace.request} />
                <details className="observatory-rag-payload">
                  <summary>Requête exacte transmise par Hermes · exact-redacted</summary>
                  <HumanJson value={trace.request} />
                </details>
              </details>
            ))}
          </div>
        </details>
      )}

      <div className="scroll-y col grow" style={{ gap: 4, minHeight: 0 }}>
        {loading && (
          <div className="c-faint" style={{ fontSize: 12 }}>
            <span className="spinner" /> chargement…
          </div>
        )}
        {!loading && entries.length === 0 && (
          <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
            Aucune étape pour l&apos;instant — écris un message ou lance une orchestration.
          </div>
        )}
        {entries.map((e, i) => {
          const meta = KIND_META[e.kind] ?? { icon: '•', label: e.kind }
          const toks = tokensOf(e)
          const modelIdentity = e.model?.trim() || e.provider
          return (
            <div key={i} className="act-step">
              <div className="row gap2" style={{ fontSize: 11 }}>
                <span>{meta.icon}</span>
                <span className="c-dim" style={{ fontWeight: 600 }}>
                  {meta.label}
                </span>
                {modelIdentity && (
                  <span className="mono c-accent">
                    {modelIdentity}
                    {e.reasoningEffort ? ` · ${e.reasoningEffort}` : ''}
                  </span>
                )}
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
              {e.kind === 'configuration-change' && e.text && (
                <details className="prompt-envelope" style={{ marginTop: 6 }}>
                  <summary>Voir le changement exact</summary>
                  <HumanJson value={e.text} />
                </details>
              )}
              {e.screenshots && e.screenshots.length > 0 && (
                <div className="row gap2 wrap" style={{ marginTop: 6 }}>
                  {e.screenshots.map((path) => (
                    <button
                      key={path}
                      className="btn btn-sm"
                      onClick={() => openProof(path)}
                      title={path}
                    >
                      ▧ preuve visuelle
                    </button>
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
      {proofError && <div className="attachment-error">⚠️ {proofError}</div>}
      {proof && (
        <div
          className="proof-lightbox"
          role="dialog"
          aria-label="Preuve visuelle"
          onClick={() => setProof(null)}
        >
          <div className="proof-card" onClick={(event) => event.stopPropagation()}>
            <div className="row gap2" style={{ justifyContent: 'space-between' }}>
              <span className="c-faint" title={proof.path}>
                ▧ Preuve visuelle
              </span>
              <button className="btn btn-sm" onClick={() => setProof(null)}>
                ×
              </button>
            </div>
            <img src={proof.dataUrl} alt={`Capture ${proof.path}`} />
          </div>
        </div>
      )}
    </div>
  )
}
