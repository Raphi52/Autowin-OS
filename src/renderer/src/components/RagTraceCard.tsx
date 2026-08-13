import { summarizeRagTrace } from './rag-trace-model'

const STATUS = {
  injected: { label: 'Injecté', tone: 'is-injected' },
  'not-injected': { label: 'Non utilisé', tone: 'is-absent' },
  unparseable: { label: 'À vérifier', tone: 'is-warning' },
  unavailable: { label: 'Indisponible', tone: 'is-absent' }
} as const

export function RagTraceCard({
  request,
  queryOverride
}: {
  request: unknown
  queryOverride?: string | null
}): React.JSX.Element {
  const rag = summarizeRagTrace(request)
  const status = STATUS[rag.status]
  const query = queryOverride === undefined ? rag.query : (queryOverride ?? '')

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
      {query && (
        <p>
          <b>Requête</b>
          <span>{query}</span>
        </p>
      )}
      {rag.sources.length > 0 && (
        <ol>
          {rag.sources.map((source) => (
            <li key={`${source.rank}:${source.path}`}>
              {source.text ? (
                <details className="rag-source-text">
                  <summary>
                    <strong>{source.path}</strong>
                    <small>
                      {[source.type, source.scope, source.author, source.date]
                        .filter(Boolean)
                        .join(' · ') || 'Provenance non renseignée'}
                    </small>
                  </summary>
                  <pre>{source.text}</pre>
                </details>
              ) : (
                <>
                  <strong>{source.path}</strong>
                  <small>
                    {[source.type, source.scope, source.author, source.date]
                      .filter(Boolean)
                      .join(' · ') || 'Provenance non renseignée'}
                  </small>
                </>
              )}
            </li>
          ))}
        </ol>
      )}
      {rag.status === 'injected' && rag.injectedText && (
        <details className="rag-injected-full">
          <summary>
            Voir le texte exact lu ({rag.injectedCharacters.toLocaleString('fr-FR')} caractères)
          </summary>
          <pre>{rag.injectedText}</pre>
        </details>
      )}
    </section>
  )
}
