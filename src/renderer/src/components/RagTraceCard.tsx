import { summarizeRagTrace } from './rag-trace-model'
import { formaterNombre } from '../langue'
import { useTextesObservatory } from '../textes-ecrans/observatory'

const STATUS = {
  injected: { cle: 'ragCarte.injecte', tone: 'is-injected' },
  'not-injected': { cle: 'ragCarte.nonUtilise', tone: 'is-absent' },
  unparseable: { cle: 'ragCarte.verifier', tone: 'is-warning' },
  unavailable: { cle: 'ragCarte.indisponible', tone: 'is-absent' }
} as const

export function RagTraceCard({
  request,
  queryOverride
}: {
  request: unknown
  queryOverride?: string | null
}): React.JSX.Element {
  const { t } = useTextesObservatory()
  const rag = summarizeRagTrace(request)
  const status = STATUS[rag.status]
  const query = queryOverride === undefined ? rag.query : (queryOverride ?? '')

  return (
    <section className={`rag-trace-card ${status.tone}`} data-rag-status={rag.status}>
      <header>
        <div>
          <span>RAG · {rag.engine}</span>
          <strong>{t(status.cle)}</strong>
        </div>
        <small>
          {rag.status === 'injected'
            ? t('ragCarte.sourcesInjectees', {
                n: rag.sources.length,
                s: rag.sources.length > 1 ? 's' : '',
                caracteres: formaterNombre(rag.injectedCharacters)
              })
            : rag.status === 'unparseable'
              ? t('ragCarte.marqueurDetecteFormatNon')
              : rag.status === 'not-injected'
                ? t('ragCarte.aucunContexteBrainCette')
                : t('ragCarte.payloadNonDisponible')}
        </small>
      </header>
      {query && (
        <p>
          <b>{t('ragCarte.requete')}</b>
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
                        .join(' · ') || t('ragCarte.provenanceNonRenseignee')}
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
                      .join(' · ') || t('ragCarte.provenanceNonRenseignee')}
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
            {t('ragCarte.voirTexteExactLu', { caracteres: formaterNombre(rag.injectedCharacters) })}
          </summary>
          <pre>{rag.injectedText}</pre>
        </details>
      )}
    </section>
  )
}
