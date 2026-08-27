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
  saveTestProjects?: (projects: Array<{ root: string; label?: string }>) => Promise<Projet[]>
  pickTestProject?: () => Promise<string | null>
  runProjectTests?: (root: string, filter?: string) => Promise<Resultat>
}

function api(): Api {
  return ((window as unknown as { api?: Api }).api ?? {}) as Api
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

  const lancer = useCallback(async () => {
    if (!projetActif) return
    setEncours(projetActif.id)
    setErreur('')
    try {
      const r = await api().runProjectTests?.(projetActif.root, filtre.trim() || undefined)
      if (r) setResultats((prev) => ({ ...prev, [projetActif.id]: r }))
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e))
    } finally {
      setEncours('')
    }
  }, [projetActif, filtre])

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

      <div className="tests-body">
        <aside className="tests-projects">
          {projets.length === 0 && (
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
          {erreur && <p className="tests-error">{erreur}</p>}
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
              {resultat.report.invalid && (
                <p className="tests-invalid" data-testid="tests-invalid">
                  ⚠ {resultat.report.invalid}
                </p>
              )}
              <ul className="tests-cases">
                {cas.map((c, i) => (
                  <li key={`${c.file}-${c.name}-${i}`} className={`tests-case is-${c.status}`}>
                    <span className="tests-case-status">{LIBELLE_STATUT[c.status]}</span>
                    <span className="tests-case-file">{c.file}</span>
                    <span className="tests-case-name">{c.name}</span>
                    {typeof c.durationMs === 'number' && (
                      <span className="tests-case-duration">{c.durationMs} ms</span>
                    )}
                    {c.error && <pre className="tests-case-error">{c.error}</pre>}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </section>
  )
}
