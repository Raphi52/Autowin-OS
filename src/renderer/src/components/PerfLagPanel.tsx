import { useCallback, useEffect, useState } from 'react'
import {
  resumerSondeRenderer,
  SEUIL_SEGMENT_LENT_MS,
  type RapportLatence,
  type ResumeSondeRenderer
} from '../../../shared/perf-lag'
import { SEUIL_GEL_MS, type ResumeGels } from '../../../shared/gel-detector'

/**
 * Onglet LATENCE de la vue Tests — « ou passe le temps ? », repondu par des faits.
 *
 * Deux instruments, deux sources distinctes :
 *  · le journal de jalons de tour (cote main, `turn-timing.jsonl`) : ce que coute chaque etape
 *    entre le clic sur Envoyer et le premier token ;
 *  · une sonde vivante du renderer : retard reel des ticks et `longtask`, qui disent si le thread
 *    d'interface se FIGE (une capture fixe ne peut pas le dire).
 */

interface RapportTours extends RapportLatence {
  disponible: boolean
  source: string
}

interface RapportGels extends ResumeGels {
  disponible: boolean
  source: string
}

type ApiPerf = {
  perfTurnLatency?: (derniers?: number) => Promise<RapportTours>
  perfGels?: (derniers?: number) => Promise<RapportGels>
}

const DUREE_SONDE_MS = 4000
const PERIODE_SONDE_MS = 200

/** Sonde REELLE du thread renderer : ce qui n'a pas tick a l'heure mesure le gel. */
async function sonderRenderer(): Promise<ResumeSondeRenderer> {
  const horodatages: number[] = [performance.now()]
  const tachesLongues: number[] = []
  let observer: PerformanceObserver | undefined
  try {
    observer = new PerformanceObserver((liste) => {
      for (const e of liste.getEntries()) tachesLongues.push(e.duration)
    })
    observer.observe({ entryTypes: ['longtask'] })
  } catch {
    /* `longtask` non supporte ici : le retard des ticks reste mesure. */
  }
  await new Promise<void>((resolve) => {
    const timer = setInterval(() => horodatages.push(performance.now()), PERIODE_SONDE_MS)
    setTimeout(() => {
      clearInterval(timer)
      resolve()
    }, DUREE_SONDE_MS)
  })
  observer?.disconnect()
  return resumerSondeRenderer({ intervalleMs: PERIODE_SONDE_MS, horodatages, tachesLongues })
}

export function PerfLagPanel(): React.JSX.Element {
  const [rapport, setRapport] = useState<RapportTours | undefined>()
  const [erreur, setErreur] = useState('')
  const [sonde, setSonde] = useState<ResumeSondeRenderer | undefined>()
  const [sondeEnCours, setSondeEnCours] = useState(false)
  const [gels, setGels] = useState<RapportGels | undefined>()

  const charger = useCallback(async () => {
    const api = (window as unknown as { api?: ApiPerf }).api
    if (typeof api?.perfTurnLatency !== 'function') {
      setErreur('canal perf:turnLatency indisponible (moteur non reconstruit ?)')
      return
    }
    try {
      setRapport(await api.perfTurnLatency(200))
      // Les gels sont un instrument DISTINCT : leur absence ne doit pas masquer les jalons.
      if (typeof api.perfGels === 'function') setGels(await api.perfGels(200))
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // Première lecture au montage. Le canal ABSENT est signalé de façon synchrone (message
    // d'erreur), comme le fait déjà `TestsView.charger` — d'où la même exception locale.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger()
  }, [charger])

  const lancerSonde = useCallback(async () => {
    setSondeEnCours(true)
    try {
      setSonde(await sonderRenderer())
    } finally {
      setSondeEnCours(false)
    }
  }, [])

  return (
    <div className="perf-panel" data-testid="perf-panel">
      <div className="perf-head">
        <button type="button" data-testid="perf-refresh" onClick={() => void charger()}>
          Relire le journal
        </button>
        <button
          type="button"
          data-testid="perf-probe"
          disabled={sondeEnCours}
          onClick={() => void lancerSonde()}
        >
          {sondeEnCours ? (
            <>
              <span className="spinner" aria-hidden="true" /> Sonde en cours…
            </>
          ) : (
            `Sonder le renderer (${DUREE_SONDE_MS / 1000} s)`
          )}
        </button>
        {rapport && (
          <span className="perf-meta">
            {rapport.tours} tours · {rapport.source}
          </span>
        )}
      </div>

      {erreur && <p className="tests-error">{erreur}</p>}

      {gels && (
        <section className="perf-gels" data-testid="perf-gels">
          <h3>Gels du process principal</h3>
          {!gels.disponible ? (
            <p className="tests-empty" data-testid="perf-gels-indisponible">
              Aucun journal de gels ({gels.source}) : le détecteur n’a pas encore tourné sur ce
              poste. Rien n’est affiché plutôt qu’un zéro rassurant.
            </p>
          ) : gels.gels === 0 ? (
            <p className="perf-suspects" data-testid="perf-gels-vide">
              Aucun blocage au-dessus de {SEUIL_GEL_MS} ms sur la fenêtre observée.
            </p>
          ) : (
            <>
              <p className="perf-suspects" data-testid="perf-gels-resume">
                {gels.gels} gel(s) · pire {gels.pireMs} ms · {gels.cumulMs} ms figés au total
              </p>
              <table className="perf-table">
                <thead>
                  <tr>
                    <th>Opération</th>
                    <th>gels</th>
                    <th>cumul</th>
                    <th>pire</th>
                  </tr>
                </thead>
                <tbody>
                  {gels.parOperation.map((o) => (
                    <tr key={o.operation}>
                      <td>{o.operation}</td>
                      <td>{o.gels}</td>
                      <td>{o.cumulMs} ms</td>
                      <td>{o.pireMs} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </section>
      )}

      {rapport && !rapport.disponible && (
        <p className="tests-empty" data-testid="perf-indisponible">
          Aucun journal de jalons ({rapport.source}) : aucun tour de chat mesuré sur ce poste. Rien
          n’est affiché plutôt qu’un zéro rassurant.
        </p>
      )}

      {rapport?.disponible && (
        <>
          <p className="perf-suspects" data-testid="perf-suspects">
            {rapport.suspects.length === 0
              ? `Aucun segment au-dessus de ${SEUIL_SEGMENT_LENT_MS} ms (p95).`
              : `Suspects (p95 > ${SEUIL_SEGMENT_LENT_MS} ms) : ` +
                rapport.suspects.map((s) => `${s.nom} (${s.p95Ms} ms)`).join(' · ')}
          </p>
          <table className="perf-table">
            <thead>
              <tr>
                <th>Segment</th>
                <th>n</th>
                <th>p50</th>
                <th>p95</th>
                <th>max</th>
              </tr>
            </thead>
            <tbody>
              {rapport.segments.map((s) => (
                <tr
                  key={s.nom}
                  data-testid="perf-segment"
                  className={s.p95Ms > SEUIL_SEGMENT_LENT_MS ? 'is-suspect' : ''}
                >
                  <td>{s.nom}</td>
                  <td>{s.n}</td>
                  <td>{s.p50Ms}</td>
                  <td>{s.p95Ms}</td>
                  <td>{s.maxMs}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rapport.lignesIllisibles > 0 && (
            <p className="tests-invalid">⚠ {rapport.lignesIllisibles} ligne(s) illisible(s)</p>
          )}
        </>
      )}

      {sonde && (
        <p className="perf-sonde" data-testid="perf-sonde">
          Renderer : {sonde.ticks} ticks · retard max {sonde.retardMaxMs} ms · {sonde.tachesLongues}{' '}
          tâche(s) longue(s), pire {sonde.tacheLonguePlusLongueMs} ms —{' '}
          {sonde.gele ? '⚠ gel observé' : 'fluide'}
        </p>
      )}
    </div>
  )
}
