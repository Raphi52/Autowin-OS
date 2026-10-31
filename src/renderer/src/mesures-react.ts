/**
 * LES MESURES DE REACT NE S'ACCUMULENT PLUS (heal « les lags », conv-1413, 2026-10-31).
 *
 * En développement, React 19.2.7 écrit une entrée `performance.measure` par composant redessiné pour
 * ses pistes DevTools, et ne la retire jamais : le navigateur la garde jusqu'au rechargement de la
 * page. Mesuré sur l'app ouverte : 84 à 133 entrées par seconde pendant un tour, 139 941 entrées
 * pour 2 765 Mo de mémoire privée, puis 1 288 Mo 38 s après `performance.clearMeasures()`.
 * `memoire.jsonl` montre la même pente depuis des jours (fenêtre à 3-4 Go, 300-500 Mo au repos), et
 * les gels de 12 à 19 s de `gels.jsonl` du 2026-10-31 20:05-20:15 UTC tombent à 3 Go, sans gel du
 * processus principal, sur des rendus aussi légers qu'un message de 148 caractères.
 *
 * CONTOURNEMENT, pas correctif de la cause : elle est dans React, et réglée en amont par le même
 * geste (`clearMeasures` juste après `measure`, facebook/react#34803), absent de 19.2.7. À retirer
 * quand React monte à une version qui le contient. Les pistes DevTools continuent de marcher : le
 * panneau Performance lit les mesures au moment où elles sont écrites.
 *
 * Seules les mesures de React sont touchées : elles se reconnaissent à `detail.devtools`, le format
 * des pistes DevTools. Celles de l'app, lues par nom (`home-decor-avenue.ts`), ne bougent pas.
 */
type Mesurer = Performance['measure']

function estMesureDeReact(options: unknown): boolean {
  if (typeof options !== 'object' || options === null) return false
  const detail = (options as { detail?: unknown }).detail
  return typeof detail === 'object' && detail !== null && 'devtools' in detail
}

/** Rend de quoi remettre `performance.measure` d'origine (pour les tests). */
export function installerMesuresReactSansRetenue(perf: Performance = performance): () => void {
  const mesurer = perf.measure
  perf.measure = function (...args: Parameters<Mesurer>): PerformanceMeasure {
    const mesure = mesurer.apply(perf, args)
    if (estMesureDeReact(args[1])) perf.clearMeasures(args[0])
    return mesure
  } as Mesurer
  return () => {
    perf.measure = mesurer
  }
}
