import { useCallback, useEffect, useState } from 'react'
import {
  resumerSondeRenderer,
  SEUIL_SEGMENT_LENT_MS,
  type RapportLatence,
  type ResumeSondeRenderer
} from '../../../shared/perf-lag'
import { SEUIL_GEL_MS, type ResumeGels } from '../../../shared/gel-detector'
import type { InventaireDisque } from '../../../main/store/inventaire-disque'
import type { EtatReleveMemoire } from '../../../main/releve-memoire'
import { formaterDate, langueCourante } from '../langue'
import {
  traduireBoardEtMaintenance,
  useTextesBoardEtMaintenance,
  type CleBoardEtMaintenance
} from '../textes-ecrans/board-et-maintenance'
import { formaterOctets } from './formater-octets'

/** Rôle Electron → mot courant (conv-1077) : « Tab » ne dit rien à qui regarde ses processus. */
// Traduits à l'affichage (conv-1170).
const ROLE_PROCESSUS: Record<string, CleBoardEtMaintenance> = {
  Browser: 'perf.role.principal',
  Tab: 'perf.role.fenetre'
}
/** « GPU » et « Service » : les mêmes mots en anglais, ils restent en dur. */
const ROLE_PROCESSUS_IDENTIQUE: Record<string, string> = {
  GPU: 'GPU',
  Utility: 'Service'
}

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
  // fix-ok: cause mesurée 2026-10-22 — section absente (PerfLagPanel.memoire.test.tsx rouge) ; joint à perf:gels car un canal de plus portait à 236 le compte de security-critical-fixes.test.ts.
  /** Memoire et CPU par processus, joint a la reponse de `perf:gels` (conv-1077). */
  memoire?: EtatReleveMemoire
}

type ApiPerf = {
  perfTurnLatency?: (derniers?: number) => Promise<RapportTours>
  perfGels?: (derniers?: number) => Promise<RapportGels>
  osDiskUsage?: () => Promise<InventaireDisque>
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
  const { t } = useTextesBoardEtMaintenance()
  /** Le rôle d'un processus : une clé de la table se traduit, un nom propre (« GPU ») reste. */
  const role = (type: string): string => {
    const cle = ROLE_PROCESSUS[type]
    return cle ? t(cle) : (ROLE_PROCESSUS_IDENTIQUE[type] ?? type)
  }
  const [rapport, setRapport] = useState<RapportTours | undefined>()
  const [erreur, setErreur] = useState('')
  const [sonde, setSonde] = useState<ResumeSondeRenderer | undefined>()
  const [sondeEnCours, setSondeEnCours] = useState(false)
  const [gels, setGels] = useState<RapportGels | undefined>()
  const [disque, setDisque] = useState<InventaireDisque | undefined>()

  const charger = useCallback(async () => {
    const api = (window as unknown as { api?: ApiPerf }).api
    if (typeof api?.perfTurnLatency !== 'function') {
      setErreur(traduireBoardEtMaintenance('perf.canalAbsent', langueCourante()))
      return
    }
    try {
      setRapport(await api.perfTurnLatency(200))
      // Les gels sont un instrument DISTINCT : leur absence ne doit pas masquer les jalons.
      if (typeof api.perfGels === 'function') setGels(await api.perfGels(200))
      // L'espace disque est un TROISIEME instrument, independant : son absence ne doit masquer ni
      // les jalons ni les gels.
      if (typeof api.osDiskUsage === 'function') setDisque(await api.osDiskUsage())
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

  const memoire = gels?.memoire
  return (
    <div className="perf-panel" data-testid="perf-panel">
      <div className="perf-head">
        <button type="button" data-testid="perf-refresh" onClick={() => void charger()}>
          {t('perf.relire')}
        </button>
        <button
          type="button"
          data-testid="perf-probe"
          disabled={sondeEnCours}
          onClick={() => void lancerSonde()}
        >
          {sondeEnCours ? (
            <>
              <span className="spinner" aria-hidden="true" /> {t('perf.sondeEnCours')}
            </>
          ) : (
            t('perf.sonder', { secondes: DUREE_SONDE_MS / 1000 })
          )}
        </button>
        {rapport && (
          <span className="perf-meta">
            {t('perf.tours', { n: rapport.tours, source: rapport.source })}
          </span>
        )}
      </div>

      {erreur && <p className="tests-error">{erreur}</p>}

      {gels && (
        <section className="perf-gels" data-testid="perf-gels">
          <h3>{t('perf.gels.titre')}</h3>
          {!gels.disponible ? (
            <p className="tests-empty" data-testid="perf-gels-indisponible">
              {t('perf.gels.indisponible', { source: gels.source })}
            </p>
          ) : gels.gels === 0 && !gels.gelsNonImputables ? (
            <p className="perf-suspects" data-testid="perf-gels-vide">
              {t('perf.gels.vide', { seuil: SEUIL_GEL_MS })}
            </p>
          ) : (
            <>
              <p className="perf-suspects" data-testid="perf-gels-resume">
                {t('perf.gels.resume', { gels: gels.gels, pire: gels.pireMs, cumul: gels.cumulMs })}
              </p>
              {/*
                Un gel non imputable est REEL pour l'utilisateur : notre process n'a pas brulé de
                CPU pendant le blocage (machine saturée, veille). On l'écarte de l'attribution par
                opération — l'opération déclarée à cet instant n'est qu'une coïncidence — mais on ne
                l'efface pas : le taire transformerait des minutes figées en « aucun blocage ».
              */}
              {gels.gelsNonImputables > 0 && (
                <p className="perf-suspects" data-testid="perf-gels-non-imputables">
                  {t('perf.gels.nonImputables', {
                    n: gels.gelsNonImputables,
                    ms: gels.msNonImputables
                  })}
                </p>
              )}
              <table className="perf-table">
                <thead>
                  <tr>
                    <th>{t('perf.col.operation')}</th>
                    <th>{t('perf.col.gels')}</th>
                    <th>{t('perf.col.cumul')}</th>
                    <th>{t('perf.col.pire')}</th>
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
          {t('perf.jalons.indisponible', { source: rapport.source })}
        </p>
      )}

      {rapport?.disponible && (
        <>
          <p className="perf-suspects" data-testid="perf-suspects">
            {rapport.suspects.length === 0
              ? t('perf.suspects.aucun', { seuil: SEUIL_SEGMENT_LENT_MS })
              : t('perf.suspects', {
                  seuil: SEUIL_SEGMENT_LENT_MS,
                  liste: rapport.suspects.map((s) => `${s.nom} (${s.p95Ms} ms)`).join(' · ')
                })}
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
            <p className="tests-invalid">{t('perf.illisibles', { n: rapport.lignesIllisibles })}</p>
          )}
        </>
      )}

      {disque && (
        <section className="perf-disque" data-testid="perf-disque">
          <h3>
            {t('perf.disque.titre', { poids: formaterOctets(disque.octets) })}
            {disque.partiel ? t('perf.auMoins') : ''}
          </h3>
          <table className="perf-table">
            <thead>
              <tr>
                <th>{t('perf.col.famille')}</th>
                <th>{t('perf.col.poids')}</th>
                <th>{t('perf.col.fichiers')}</th>
                <th>{t('perf.col.menage')}</th>
              </tr>
            </thead>
            <tbody>
              {disque.familles.map((famille) => {
                const menage = disque.menage.find((passe) => passe.famille === famille.nom)
                return (
                  <tr key={famille.nom} data-testid="perf-disque-famille">
                    <td>{famille.nom}</td>
                    <td>
                      {formaterOctets(famille.octets)}
                      {famille.partiel ? t('perf.auMoins') : ''}
                    </td>
                    <td>{famille.fichiers}</td>
                    <td>
                      {menage
                        ? t('perf.menage', {
                            supprimes: menage.supprimes,
                            liberes: formaterOctets(menage.octetsLiberes)
                          }) +
                          (menage.restants === undefined
                            ? ''
                            : t('perf.menage.reste', { n: menage.restants }))
                        : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <p className="perf-disque-note">{t('perf.disque.note')}</p>
        </section>
      )}

      {memoire?.dernier && (
        <section className="perf-disque" data-testid="perf-memoire">
          <h3>
            {t('perf.memoire.titre', {
              total: memoire.dernier.totalMo,
              pic: memoire.picTotalMo
            })}
          </h3>
          <table className="perf-table">
            <thead>
              <tr>
                <th>{t('perf.col.processus')}</th>
                <th>PID</th>
                <th>{t('perf.col.memoire')}</th>
                <th>{t('perf.col.processeur')}</th>
              </tr>
            </thead>
            <tbody>
              {memoire.dernier.processus.map((p) => (
                <tr key={p.pid} data-testid="perf-memoire-processus">
                  <td>
                    {role(p.type)}
                    {p.nom && p.nom !== p.type ? ` (${p.nom})` : ''}
                  </td>
                  <td>{p.pid}</td>
                  <td>{t('octets.mo', { n: p.memoireMo })}</td>
                  <td>{p.cpuPct} %</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="perf-disque-note">
            {t('perf.memoire.note', {
              heure: formaterDate(memoire.dernier.ts, { timeStyle: 'medium' }),
              secondes: Math.round(memoire.periodeMs / 1000),
              n: memoire.echantillons
            })}
          </p>
        </section>
      )}

      {sonde && (
        <p className="perf-sonde" data-testid="perf-sonde">
          {t('perf.sonde', {
            ticks: sonde.ticks,
            retard: sonde.retardMaxMs,
            longues: sonde.tachesLongues,
            pire: sonde.tacheLonguePlusLongueMs,
            verdict: t(sonde.gele ? 'perf.sonde.gel' : 'perf.sonde.fluide')
          })}
        </p>
      )}
    </div>
  )
}
