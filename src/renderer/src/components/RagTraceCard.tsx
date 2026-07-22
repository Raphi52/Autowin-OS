import { summarizeRagTrace } from './rag-trace-model'

const STATUS = {
  injected: { label: 'Injecté', tone: 'is-injected' },
  'not-injected': { label: 'Non utilisé', tone: 'is-absent' },
  unparseable: { label: 'À vérifier', tone: 'is-warning' },
  unavailable: { label: 'Indisponible', tone: 'is-absent' }
} as const

export function RagTraceCard({ request }: { request: unknown }): React.JSX.Element {
  const rag = summarizeRagTrace(request)
  const status = STATUS[rag.status]

  return (
    <section className={`rag-trace-card ${status.tone}`} data-rag-status={rag.status}>
      <header>
        <div>
          <span>RAG · {rag.engine}</span>
          <strong>{status.label}</strong>
        </div>
        <small>
          {rag.status === 'injected'
            ? `${rag.sources.length} source${rag.sources.length > 1 ? 's' : ''} · ${rag.injectedCharacters.toLocaleString('fr-FR')} caractères injectés`
            : rag.status === 'unparseable'
              ? 'Marqueur détecté · format non analysable'
              : rag.status === 'not-injected'
                ? 'Aucun contexte Brain dans cette requête'
                : 'Payload non disponible'}
        </small>
      </header>
      {rag.query && (
        <p>
          <b>Requête</b>
          <span>{rag.query}</span>
        </p>
      )}
      {rag.sources.length > 0 && (
        <ol>
          {rag.sources.map((source) => (
            <li key={`${source.rank}:${source.path}`}>
              <strong>{source.path}</strong>
              <small>
                {[source.type, source.scope, source.author, source.date]
                  .filter(Boolean)
                  .join(' · ') || 'Provenance non renseignée'}
              </small>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

export function RagObservabilitySummary({
  requests
}: {
  requests: readonly unknown[]
}): React.JSX.Element {
  const traces = requests.map(summarizeRagTrace)
  const injected = traces.filter((trace) => trace.status === 'injected').length
  const notInjected = traces.filter((trace) => trace.status === 'not-injected').length
  const unparseable = traces.filter((trace) => trace.status === 'unparseable').length
  const status =
    requests.length === 0
      ? 'unavailable'
      : unparseable > 0
        ? 'unparseable'
        : injected > 0
          ? 'injected'
          : 'not-injected'
  const diagnostic =
    status === 'injected'
      ? 'Contexte Brain observé dans la requête native.'
      : status === 'unparseable'
        ? 'Marqueur Brain observé, mais sa provenance reste non analysable.'
        : status === 'not-injected'
          ? 'Requêtes natives observées sans contexte Brain injecté.'
          : 'Aucune requête native disponible pour contrôler le RAG.'

  return (
    <section className={`observatory-rag-summary is-${status}`} data-rag-status={status}>
      <strong>Traçabilité RAG · natif</strong>
      {requests.length === 0 ? (
        <span>Aucune trace native disponible · récupération non observable</span>
      ) : (
        <span>
          {requests.length} appel{requests.length > 1 ? 's' : ''} · {injected} injecté
          {injected > 1 ? 's' : ''} · {notInjected} sans RAG · {unparseable} non analysable
        </span>
      )}
      <small>{diagnostic}</small>
    </section>
  )
}
