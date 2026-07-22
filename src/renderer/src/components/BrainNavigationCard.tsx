interface BrainNavigationCandidate {
  rank: number
  path: string
  type: string
  denseCos: number
  retained: boolean
}
interface BrainNavigation {
  query: string
  minDense: number
  candidates: BrainNavigationCandidate[]
}
export interface BrainTraceView {
  timestamp: string
  conversationId: string
  query: string
  injectedChars: number
  navigation?: BrainNavigation
}

/**
 * Carte « Navigation Brain » : ce que le Brain a fait pour un tour — requête réelle envoyée, candidats
 * PARCOURUS puis SCORÉS (dense_cos), RETENUS (≥ seuil) vs écartés, et caractères INJECTÉS dans le prompt.
 * Alimentée par la trace Brain dédiée (os:brainTraces), distincte de la reconstruction RAG depuis l'injecté.
 */
export function BrainNavigationCard({ trace }: { trace: BrainTraceView }): React.JSX.Element {
  const nav = trace.navigation
  const retained = nav?.candidates.filter((c) => c.retained).length ?? 0
  const status = trace.injectedChars > 0 ? 'is-injected' : 'is-absent'
  return (
    <section className={`brain-nav-card ${status}`} data-brain-status={status}>
      <header>
        <span>Navigation Brain</span>
        <strong>
          {nav ? `${nav.candidates.length} parcouru${nav.candidates.length > 1 ? 's' : ''} · ${retained} retenu${retained > 1 ? 's' : ''}` : 'navigation non exposée'}
        </strong>
        <small>{trace.injectedChars.toLocaleString('fr-FR')} caractères injectés</small>
      </header>
      {trace.query && (
        <p className="brain-nav-query">
          <b>Requête</b>
          <span>{trace.query}</span>
        </p>
      )}
      {nav && nav.candidates.length > 0 && (
        <ol className="brain-nav-candidates">
          {nav.candidates.map((c) => (
            <li key={`${c.rank}:${c.path}`} className={c.retained ? 'is-retained' : 'is-dropped'}>
              <span className="brain-nav-rank">#{c.rank}</span>
              <strong>{c.path}</strong>
              <span className="brain-nav-score">dense {c.denseCos.toFixed(3)}</span>
              <span className="brain-nav-badge">
                {c.retained ? 'retenu → injecté' : `écarté (< ${nav.minDense})`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
