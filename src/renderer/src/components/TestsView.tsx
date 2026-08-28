import { useCallback, useEffect, useMemo, useState } from 'react'
import './TestsView.css'

/**
 * Vue Tests — MULTI-PROJETS par construction.
 *
 * Un projet y est une racine du registre (`test-projects.json`), jamais le dépôt de l'app : le même
 * écran sert Autowin OS et n'importe quel projet ajouté ensuite. Le verdict affiché vient du rapport
 * JSON du harnais du projet ; une sortie illisible est AVOUÉE (`tests-invalid`) au lieu d'être
 * comptée comme un vert à zéro test.
 */

type Statut = 'passed' | 'failed' | 'skipped'

interface Cas {
  file: string
  name: string
  status: Statut
  durationMs?: number
  error?: string
}

interface Projet {
  id: string
  label: string
  root: string
  runner: string
  runnable: boolean
  reason?: string
}

interface Resultat {
  root: string
  runner: string
  exitCode: number | null
  durationMs: number
  totals: { passed: number; failed: number; skipped: number; total: number }
  report: { cases: Cas[]; invalid?: string }
}

type Api = {
  testProjects?: () => Promise<Projet[]>
  revealFile?: (path: string, line?: number) => Promise<{ ok: boolean; reason?: string }>
  saveTestProjects?: (projects: Array<{ root: string; label?: string }>) => Promise<Projet[]>
  pickTestProject?: () => Promise<string | null>
  runProjectTests?: (root: string, filter?: string) => Promise<Resultat>
}

function api(): Api {
  return ((window as unknown as { api?: Api }).api ?? {}) as Api
}

/** Cle de la MEMOIRE du dernier run : rouvrir la vue ne doit pas repartir d'un ecran vide. */
const CLE_MEMOIRE = 'autowin.tests.lastRun'

function lireMemoire(): Record<string, Resultat> {
  try {
    const brut = window.localStorage.getItem(CLE_MEMOIRE)
    if (!brut) return {}
    const parsed = JSON.parse(brut) as Record<string, Resultat>
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {} // memoire corrompue : rien, jamais un resultat invente
  }
}

function ecrireMemoire(resultats: Record<string, Resultat>): void {
  try {
    window.localStorage.setItem(CLE_MEMOIRE, JSON.stringify(resultats))
  } catch {
    /* stockage indisponible : la memoire est un confort, jamais un verdict */
  }
}

/** Numero de ligne LU dans la trace (`fichier:42:3`) - jamais devine. */
function ligneDeLErreur(fichier: string, erreur?: string): number | undefined {
  if (!erreur) return undefined
  const echappe = fichier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = new RegExp(echappe + ':(\\d+)').exec(erreur)
  return m ? Number(m[1]) : undefined
}

const LIBELLE_STATUT: Record<Statut, string> = {
  passed: '✓',
  failed: '✕',
  skipped: '•'
}

export function TestsView({ active }: { active: boolean }): React.JSX.Element {
  const [projets, setProjets] = useState<Projet[]>([])
  const [selection, setSelection] = useState<string>('')
  const [filtre, setFiltre] = useState('')
  const [resultats, setResultats] = useState<Record<string, Resultat>>({})
  const [encours, setEncours] = useState<string>('')
  const [erreur, setErreur] = useState<string>('')
  const [seulsEchecs, setSeulsEchecs] = useState(false)
  const [replies, setReplies] = useState<Record<string, boolean>>({})
  const [memorises, setMemorises] = useState<Record<string, boolean>>({})
  const [chrono, setChrono] = useState(0)

  // MEMOIRE : le dernier run connu est restaure au montage et ETIQUETE, jamais presente comme frais.
  useEffect(() => {
    const memoire = lireMemoire()
    const ids = Object.keys(memoire)
    if (ids.length === 0) return
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setResultats((prev) => ({ ...memoire, ...prev }))

    setMemorises(Object.fromEntries(ids.map((id) => [id, true])))
  }, [])

  // Progression VIVANTE : sans flux du harnais, le chrono est le signal honnete que le run avance.
  // Il nait et meurt avec le run - aucun bandeau code en dur.
  useEffect(() => {
    if (!encours) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChrono(0)
      return
    }
    const debut = Date.now()
    const t = setInterval(() => setChrono(Date.now() - debut), 200)
    return () => clearInterval(t)
  }, [encours])

  const charger = useCallback(async () => {
    // Un canal ABSENT (moteur non reconstruit, preload périmé) ne doit pas se déguiser en « aucun
    // projet » : c'est le faux-vert exact que la vue est censée rendre impossible.
    if (typeof api().testProjects !== 'function') {
      setErreur('canal tests:projects indisponible (moteur non reconstruit ?)')
      return
    }
    try {
      const liste = (await api().testProjects?.()) ?? []
      setProjets(liste)
      setSelection((courant) => courant || liste[0]?.id || '')
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (active) void charger()
  }, [active, charger])

  const projetActif = useMemo(
    () => projets.find((p) => p.id === selection) ?? projets[0],
    [projets, selection]
  )
  const resultat = projetActif ? resultats[projetActif.id] : undefined

  const lancer = useCallback(
    async (cible?: string) => {
      if (!projetActif) return
      setEncours(projetActif.id)
      setErreur('')
      try {
        // Relance CIBLEE : la cible passee prime ; le filtre global reste INTACT.
        const motif = cible ?? (filtre.trim() || undefined)
        const r = await api().runProjectTests?.(projetActif.root, motif)
        if (r) {
          setResultats((prev) => {
            const suite = { ...prev, [projetActif.id]: r }
            ecrireMemoire(suite)
            return suite
          })
          setMemorises((prev) => ({ ...prev, [projetActif.id]: false }))
        }
      } catch (e) {
        setErreur(e instanceof Error ? e.message : String(e))
      } finally {
        setEncours('')
      }
    },
    [projetActif, filtre]
  )

  const ajouter = useCallback(async () => {
    const racine = await api().pickTestProject?.()
    if (!racine) return
    const liste = await api().saveTestProjects?.([
      ...projets.map((p) => ({ root: p.root, label: p.label })),
      { root: racine }
    ])
    if (liste) setProjets(liste)
  }, [projets])

  const retirer = useCallback(
    async (id: string) => {
      const liste = await api().saveTestProjects?.(
        projets.filter((p) => p.id !== id).map((p) => ({ root: p.root, label: p.label }))
      )
      if (liste) setProjets(liste)
    },
    [projets]
  )

  const cas = (resultat?.report.cases ?? []).filter((c) => !seulsEchecs || c.status === 'failed')
  const groupes = useMemo(() => {
    const map = new Map<string, Cas[]>()
    for (const c of cas) map.set(c.file, [...(map.get(c.file) ?? []), c])
    return [...map.entries()]
  }, [cas])

  const copierErreur = useCallback(async (c: Cas) => {
    try {
      await navigator.clipboard?.writeText(`${c.file} > ${c.name}\n${c.error ?? ''}`)
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    }
  }, [])

  const ouvrirErreur = useCallback(
    async (c: Cas) => {
      if (!projetActif) return
      await api().revealFile?.(`${projetActif.root}/${c.file}`, ligneDeLErreur(c.file, c.error))
    },
    [projetActif]
  )

  return (
    <section className="tests-view" data-testid="tests-view">
      <header className="tests-head">
        <h2>Tests</h2>
        <div className="tests-actions">
          <input
            className="tests-filter"
            data-testid="tests-filter"
            placeholder="Filtrer (motif de fichier)"
            value={filtre}
            onChange={(e) => setFiltre(e.target.value)}
          />
          <label className="tests-toggle">
            <input
              type="checkbox"
              checked={seulsEchecs}
              onChange={(e) => setSeulsEchecs(e.target.checked)}
            />
            Échecs seuls
          </label>
          <button data-testid="tests-add" onClick={() => void ajouter()}>
            + Projet
          </button>
          <button
            data-testid="tests-run"
            className="tests-run"
            disabled={!projetActif || Boolean(encours)}
            onClick={() => void lancer()}
          >
            {encours ? 'Exécution…' : 'Lancer la suite'}
          </button>
        </div>
      </header>

      {encours && (
        <p className="tests-progress" data-testid="tests-progress">
          ⏳ {projets.find((p) => p.id === encours)?.label ?? encours} — exécution en cours ·{' '}
          {(chrono / 1000).toFixed(1)} s
        </p>
      )}

      <div className="tests-body">
        <aside className="tests-projects">
          {/* Un canal mort ne doit pas coexister avec une invite a ajouter un projet : l'invite
              ne vaut que si le registre a REELLEMENT repondu vide. */}
          {erreur && <p className="tests-error">{erreur}</p>}
          {projets.length === 0 && !erreur && (
            <p className="tests-empty">
              Aucun projet enregistré. « + Projet » ajoute n’importe quelle racine (Autowin OS ou un
              autre dépôt).
            </p>
          )}
          {projets.map((p) => {
            const r = resultats[p.id]
            return (
              <div
                key={p.id}
                data-testid="test-project"
                className={`tests-project${p.id === projetActif?.id ? ' is-active' : ''}`}
              >
                <button onClick={() => setSelection(p.id)} title={p.root}>
                  <span className="tests-project-label">{p.label}</span>
                  <span className="tests-project-runner">{p.runner}</span>
                  {r && (
                    <span className="tests-project-totals">
                      {r.totals.failed > 0 ? `${r.totals.failed} échec(s)` : `${r.totals.passed} ✓`}
                    </span>
                  )}
                  {!p.runnable && <span className="tests-project-reason">{p.reason}</span>}
                </button>
                <button
                  className="tests-project-remove"
                  title="Retirer du registre"
                  onClick={() => void retirer(p.id)}
                >
                  ×
                </button>
              </div>
            )
          })}
        </aside>

        <div className="tests-results">
          {!resultat && projetActif && (
            <p className="tests-empty">
              {projetActif.runnable
                ? 'Aucune exécution pour ce projet. « Lancer la suite » produit le rapport.'
                : (projetActif.reason ?? 'Projet non exécutable.')}
            </p>
          )}
          {resultat && (
            <>
              <div className="tests-summary" data-testid="tests-totals">
                <span className="ok">{resultat.totals.passed} passés</span>
                <span className="ko">{resultat.totals.failed} échecs</span>
                <span className="sk">{resultat.totals.skipped} ignorés</span>
                <span className="meta">
                  {resultat.runner} · {resultat.durationMs} ms · exit {String(resultat.exitCode)}
                </span>
              </div>
              {projetActif && memorises[projetActif.id] && (
                <p className="tests-memo" data-testid="tests-memo">
                  ↺ dernier run mémorisé (non rejoué)
                </p>
              )}
              {resultat.report.invalid && (
                <p className="tests-invalid" data-testid="tests-invalid">
                  ⚠ {resultat.report.invalid}
                </p>
              )}
              <ul className="tests-cases">
                {groupes.map(([fichier, items]) => {
                  const replie = replies[fichier] === true
                  const echecs = items.filter((c) => c.status === 'failed').length
                  return (
                    <li key={fichier} className="tests-file" data-testid="tests-file-group">
                      <div className="tests-file-head">
                        <button
                          data-testid="tests-file-toggle"
                          className="tests-file-toggle"
                          onClick={() => setReplies((p) => ({ ...p, [fichier]: !replie }))}
                        >
                          {replie ? '▸' : '▾'} {fichier}
                        </button>
                        <span className="tests-file-count">
                          {echecs > 0 ? `${echecs} échec(s)` : `${items.length} ✓`}
                        </span>
                        <button
                          data-testid="tests-file-rerun"
                          className="tests-file-rerun"
                          disabled={Boolean(encours)}
                          title="Rejouer ce fichier seul"
                          onClick={() => void lancer(fichier)}
                        >
                          ⟲
                        </button>
                      </div>
                      {!replie && (
                        <ul className="tests-file-cases">
                          {items.map((c, i) => (
                            <li key={`${c.name}-${i}`} className={`tests-case is-${c.status}`}>
                              <span className="tests-case-status">{LIBELLE_STATUT[c.status]}</span>
                              <span className="tests-case-name">{c.name}</span>
                              {typeof c.durationMs === 'number' && (
                                <span className="tests-case-duration">{c.durationMs} ms</span>
                              )}
                              {c.error && (
                                <>
                                  <pre className="tests-case-error">{c.error}</pre>
                                  <span className="tests-case-tools">
                                    <button
                                      data-testid="tests-case-copy"
                                      onClick={() => void copierErreur(c)}
                                    >
                                      Copier l’erreur
                                    </button>
                                    <button
                                      data-testid="tests-case-open"
                                      onClick={() => void ouvrirErreur(c)}
                                    >
                                      Ouvrir le fichier
                                    </button>
                                  </span>
                                </>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
