import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { InboxCandidate } from '../../../main/brain-inbox'
import { brainBusinessError } from './graph-view-model'
import { Spinner } from './Spinner'

/**
 * BOÎTE DE RÉCEPTION du savoir, dans la vue Knowledge.
 *
 * Pourquoi (2026-08-10) : `brain_remember` dépose TOUJOURS en `inbox/`, jamais en `knowledge/`, parce
 * que « la promotion reste HUMAINE ». Sauf qu'aucun écran ne la permettait : les candidats se
 * confondaient avec le reste du graphe et personne ne pouvait ni les valider ni les refuser. La revue
 * s'accumulait donc indéfiniment.
 *
 * Ce panneau affiche, PAR FICHE, ce dont la décision a besoin :
 *  - la source normalisée (`git:<chemin>@<sha>`) et son problème de traçabilité s'il y en a un ;
 *  - l'âge du dépôt, et un signal quand le sha cité n'est PLUS le dernier commit du fichier ;
 *  - le quasi-jumeau éventuel — `inbox/` n'étant pas dédoublonnée côté serveur, deux dépôts du même
 *    fait y coexistent silencieusement.
 *
 * Promouvoir et Rejeter déplacent le fichier côté main, puis la réindexation est demandée par
 * `onIndexChanged` : sans elle, le graphe continuerait d'afficher l'ancien emplacement.
 */

export type InboxCandidateView = InboxCandidate

/**
 * Ce que dit chaque état de sha — « non vérifié » n'est PAS « à jour ». Non exporté : ce fichier
 * n'exporte qu'un composant (`react-refresh/only-export-components`).
 */
const SHA_STATE_LABELS: Record<NonNullable<InboxCandidateView['source']>['shaState'], string> = {
  current: 'sha à jour',
  stale: 'sha obsolète — le fichier a changé depuis',
  unknown: 'sha non vérifié localement',
  absent: 'sans sha'
}

function ageLabel(candidate: InboxCandidateView): string {
  if (candidate.ageDays === undefined) return 'âge inconnu'
  if (candidate.ageDays === 0) return 'déposé aujourd’hui'
  return `déposé il y a ${candidate.ageDays} jour${candidate.ageDays === 1 ? '' : 's'}`
}

export function KnowledgeInboxPanel({
  brainPath,
  onIndexChangeStarted,
  onIndexChanged
}: {
  brainPath: string
  onIndexChangeStarted?: () => void
  onIndexChanged?: (brainPath: string) => void | Promise<void>
}): React.JSX.Element {
  const [candidates, setCandidates] = useState<InboxCandidateView[]>([])
  const [error, setError] = useState('')
  const [decisionErrors, setDecisionErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(() => new Set())
  const [loading, setLoading] = useState(false)
  const [loadedBodies, setLoadedBodies] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [bodyErrors, setBodyErrors] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [loadingBodies, setLoadingBodies] = useState<ReadonlySet<string>>(() => new Set())
  const scopeGenerationRef = useRef(0)
  const readGenerationRef = useRef(0)
  const brainPathRef = useRef(brainPath)
  const busyIdsRef = useRef<Set<string>>(new Set())
  const bodyCacheRef = useRef<Map<string, string>>(new Map())
  const bodyLoadsRef = useRef<Set<string>>(new Set())

  /**
   * La boucle `remember -> promotion -> trouvable` se terminait dans le silence : la fiche quittait la
   * liste et rien ne disait si le savoir était DÉJÀ interrogeable. On rend les deux temps visibles.
   */
  const [indexState, setIndexState] = useState<
    | { phase: 'idle' }
    | { phase: 'reindexing'; action: 'promote' | 'reject'; title: string }
    | { phase: 'searchable'; action: 'promote' | 'reject'; title: string }
  >({ phase: 'idle' })

  useLayoutEffect(() => {
    brainPathRef.current = brainPath
    scopeGenerationRef.current += 1
    readGenerationRef.current += 1
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidates([])
    setError('')
    setDecisionErrors(new Map())
    busyIdsRef.current = new Set()
    setBusyIds(new Set())
    bodyCacheRef.current = new Map()
    bodyLoadsRef.current = new Set()
    setLoadedBodies(new Map())
    setBodyErrors(new Map())
    setLoadingBodies(new Set())
    setLoading(false)
    setIndexState({ phase: 'idle' })
  }, [brainPath])

  const reload = useCallback((): void => {
    if (!brainPath) {
      setCandidates([])
      return
    }
    const requestedBrainPath = brainPath
    const scopeGeneration = scopeGenerationRef.current
    const readGeneration = ++readGenerationRef.current
    const isCurrent = (): boolean =>
      brainPathRef.current === requestedBrainPath &&
      scopeGenerationRef.current === scopeGeneration &&
      readGenerationRef.current === readGeneration
    setCandidates([])
    setError('')
    bodyCacheRef.current = new Map()
    bodyLoadsRef.current = new Set()
    setLoadedBodies(new Map())
    setBodyErrors(new Map())
    setLoadingBodies(new Set())
    setLoading(true)
    window.api
      .listInbox(brainPath)
      .then((found) => {
        if (!isCurrent()) return
        setCandidates(found)
        setError('')
      })
      .catch((cause) => {
        if (isCurrent())
          setError(brainBusinessError('Impossible de charger la boîte de réception.', cause))
      })
      .finally(() => {
        if (isCurrent()) setLoading(false)
      })
  }, [brainPath])

  // Le montage doit LIRE la boîte : `reload` pose un état de chargement puis résout hors du rendu.
  // Même dérogation que la recherche de GraphView, pour la même raison — la donnée vit côté main.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => reload(), [reload])

  const decide = useCallback(
    async (candidate: InboxCandidateView, action: 'promote' | 'reject'): Promise<void> => {
      const decidedBrainPath = brainPath
      const scopeGeneration = scopeGenerationRef.current
      const isCurrent = (): boolean =>
        brainPathRef.current === decidedBrainPath && scopeGenerationRef.current === scopeGeneration
      if (busyIdsRef.current.has(candidate.id)) return
      busyIdsRef.current.add(candidate.id)
      setBusyIds(new Set(busyIdsRef.current))
      onIndexChangeStarted?.()
      try {
        if (action === 'promote') await window.api.promoteInbox(brainPath, candidate.id)
        else await window.api.rejectInbox(brainPath, candidate.id)
        if (!isCurrent()) return
        setError('')
        setDecisionErrors((current) => {
          if (!current.has(candidate.id)) return current
          const next = new Map(current)
          next.delete(candidate.id)
          return next
        })
        // Le fichier a bougé : la liste ET l'index du graphe sont périmés.
        reload()
        setIndexState({ phase: 'reindexing', action, title: candidate.title })
        await Promise.resolve(onIndexChanged?.(brainPath))
        if (isCurrent()) setIndexState({ phase: 'searchable', action, title: candidate.title })
      } catch (cause) {
        if (isCurrent()) {
          const message = brainBusinessError("Impossible d'appliquer cette décision.", cause)
          setDecisionErrors((current) => new Map(current).set(candidate.id, message))
        }
      } finally {
        if (isCurrent()) {
          busyIdsRef.current.delete(candidate.id)
          setBusyIds(new Set(busyIdsRef.current))
        }
      }
    },
    [brainPath, onIndexChanged, onIndexChangeStarted, reload]
  )

  const reviewWarnings = [...new Set(candidates.flatMap((candidate) => candidate.warnings ?? []))]

  const loadBody = useCallback(
    async (candidate: InboxCandidateView): Promise<void> => {
      if (
        !candidate.bodyTruncated ||
        bodyCacheRef.current.has(candidate.id) ||
        bodyLoadsRef.current.has(candidate.id)
      ) {
        return
      }
      const requestedBrainPath = brainPath
      const scopeGeneration = scopeGenerationRef.current
      const readGeneration = readGenerationRef.current
      const isCurrent = (): boolean =>
        brainPathRef.current === requestedBrainPath &&
        scopeGenerationRef.current === scopeGeneration &&
        readGenerationRef.current === readGeneration
      bodyLoadsRef.current.add(candidate.id)
      setLoadingBodies(new Set(bodyLoadsRef.current))
      try {
        const loaded = await window.api.readInboxCandidateBody(brainPath, candidate.id)
        if (!isCurrent()) return
        bodyCacheRef.current.set(candidate.id, loaded.body)
        setLoadedBodies(new Map(bodyCacheRef.current))
        setBodyErrors((current) => {
          if (!current.has(candidate.id)) return current
          const next = new Map(current)
          next.delete(candidate.id)
          return next
        })
      } catch (cause) {
        if (!isCurrent()) return
        const message = brainBusinessError('Impossible de charger le contenu.', cause)
        setBodyErrors((current) => new Map(current).set(candidate.id, message))
      } finally {
        if (isCurrent()) {
          bodyLoadsRef.current.delete(candidate.id)
          setLoadingBodies(new Set(bodyLoadsRef.current))
        }
      }
    },
    [brainPath]
  )

  return (
    <section className="knowledge-inbox" aria-label="Boîte de réception du savoir">
      <header className="knowledge-inbox__head">
        <span>Boîte de réception</span>
        <strong>
          {candidates.length} candidat{candidates.length === 1 ? '' : 's'}
        </strong>
        <button onClick={reload} disabled={!brainPath || loading}>
          {loading ? 'lecture…' : 'Actualiser'}
        </button>
      </header>

      {error && (
        <p className="knowledge-inbox__error" role="alert">
          <span>{error}</span>
          <button type="button" className="knowledge-inbox__retry" onClick={reload}>
            Réessayer
          </button>
        </p>
      )}

      {indexState.phase !== 'idle' && (
        <p
          className={`knowledge-inbox__index is-${indexState.phase}`}
          data-index-state={indexState.phase}
          role="status"
          aria-live="polite"
        >
          {indexState.phase === 'reindexing' ? (
            <>
              <Spinner /> {`« ${indexState.title} » — réindexation en cours…`}
            </>
          ) : indexState.action === 'promote' ? (
            `« ${indexState.title} » est promue et trouvable par la recherche.`
          ) : (
            `« ${indexState.title} » est rejetée : elle n’est plus trouvable par la recherche.`
          )}
        </p>
      )}

      {reviewWarnings.length > 0 && (
        <ul className="knowledge-inbox__warning" role="status">
          {reviewWarnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}

      {decisionErrors.size > 0 && (
        <ul className="knowledge-inbox__error" role="alert">
          {[...decisionErrors].map(([candidateId, message]) => (
            <li key={candidateId}>
              {candidateId} — {message}
            </li>
          ))}
        </ul>
      )}

      {!error && candidates.length === 0 && !loading && (
        <p className="knowledge-inbox__empty">
          Aucun candidat en attente — tout ce qui a été déposé a été tranché.
        </p>
      )}

      <ul className="knowledge-inbox__list">
        {candidates.map((candidate) => {
          const twin = candidate.nearDuplicates[0]
          return (
            <li key={candidate.id} data-candidate-id={candidate.id}>
              <details
                onToggle={(event) => {
                  if (event.currentTarget.open) void loadBody(candidate)
                }}
              >
                <summary>
                  <strong>{candidate.title}</strong>
                  {candidate.type && (
                    <span className="knowledge-inbox__type">{candidate.type}</span>
                  )}
                  <small>{ageLabel(candidate)}</small>
                  {twin && (
                    <span className="knowledge-inbox__dup" title={`proche de ${twin.id}`}>
                      doublon probable {Math.round(twin.similarity * 100)} %
                    </span>
                  )}
                </summary>

                <dl className="knowledge-inbox__meta">
                  <dt>Source</dt>
                  <dd data-sha-state={candidate.source?.shaState ?? 'absent'}>
                    {candidate.source ? (
                      <>
                        <code>{candidate.source.locator}</code>
                        <span className="knowledge-inbox__sha">
                          {SHA_STATE_LABELS[candidate.source.shaState]}
                        </span>
                        {candidate.source.problem && (
                          <em className="knowledge-inbox__source-problem">
                            {candidate.source.problem}
                          </em>
                        )}
                      </>
                    ) : (
                      <em className="knowledge-inbox__source-problem">
                        aucune source déclarée — fait non traçable
                      </em>
                    )}
                  </dd>
                  {candidate.scope && (
                    <>
                      <dt>Portée</dt>
                      <dd>{candidate.scope}</dd>
                    </>
                  )}
                  <dt>Déposé</dt>
                  <dd>{candidate.depositedAt ?? 'date inconnue'}</dd>
                </dl>

                {candidate.nearDuplicates.length > 0 && (
                  <div className="knowledge-inbox__twins" role="note">
                    <strong>Quasi-jumeaux</strong>
                    <ul>
                      {candidate.nearDuplicates.map((duplicate) => (
                        <li key={duplicate.id}>
                          {duplicate.id}
                          <span>
                            {' — '}
                            {Math.round(duplicate.similarity * 100)} %
                            {duplicate.zone === 'knowledge'
                              ? ' · DÉJÀ dans le savoir canonique'
                              : ' · autre candidat en attente'}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {candidate.nearDuplicatesOmitted && (
                      <small>
                        Non affichés : {candidate.nearDuplicatesOmitted.inbox} inbox ·{' '}
                        {candidate.nearDuplicatesOmitted.knowledge} knowledge.
                        {(candidate.nearDuplicatesOmitted.knowledge > 0 ||
                          candidate.nearDuplicates.some(({ zone }) => zone === 'knowledge')) &&
                          ' Le meilleur doublon canonique reste toujours visible.'}
                      </small>
                    )}
                    <small>
                      Similarité lexicale, calculée hors du serveur : un signal pour la revue, pas
                      un verdict. Rien n’est fusionné automatiquement.
                    </small>
                  </div>
                )}

                <pre className="knowledge-inbox__body">
                  {loadedBodies.get(candidate.id) ?? candidate.body}
                  {candidate.bodyTruncated && !loadedBodies.has(candidate.id) ? '…' : ''}
                </pre>
                {loadingBodies.has(candidate.id) && <small>lecture du corps complet…</small>}
                {bodyErrors.has(candidate.id) && (
                  <small className="knowledge-inbox__source-problem" role="alert">
                    {bodyErrors.get(candidate.id)}
                  </small>
                )}

                <div className="knowledge-inbox__actions">
                  <button
                    className="is-promote"
                    disabled={busyIds.has(candidate.id)}
                    onClick={() => void decide(candidate, 'promote')}
                  >
                    Promouvoir
                  </button>
                  <button
                    className="is-reject"
                    disabled={busyIds.has(candidate.id)}
                    onClick={() => void decide(candidate, 'reject')}
                  >
                    Rejeter
                  </button>
                  <small>
                    Promouvoir déplace la fiche dans <code>knowledge/</code> ; rejeter l’envoie dans{' '}
                    <code>.trash/</code> — réversible, rien n’est supprimé.
                  </small>
                </div>
              </details>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
