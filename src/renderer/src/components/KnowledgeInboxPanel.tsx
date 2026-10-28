import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { InboxCandidate } from '../../../main/brain-inbox'
import { brainBusinessError } from './graph-view-model'
import { Spinner } from './Spinner'
import { langueCourante } from '../langue'
import {
  traduireKnowledge,
  useTextesKnowledge,
  type CleKnowledge
} from '../textes-ecrans/knowledge'

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
const SHA_STATE_LABELS: Record<
  NonNullable<InboxCandidateView['source']>['shaState'],
  CleKnowledge
> = {
  current: 'boite.sha.current',
  stale: 'boite.sha.stale',
  unknown: 'boite.sha.unknown',
  absent: 'boite.sha.absent'
}

type Traduire = ReturnType<typeof useTextesKnowledge>['t']

function ageLabel(candidate: InboxCandidateView, t: Traduire): string {
  if (candidate.ageDays === undefined) return t('boite.age.inconnu')
  if (candidate.ageDays === 0) return t('boite.age.aujourdhui')
  return t(candidate.ageDays === 1 ? 'boite.age.unJour' : 'boite.age.jours', {
    n: candidate.ageDays
  })
}

/**
 * « Trier avec /curate » : la revue des candidats est une SKILL (`curate`), pas un geste d'écran —
 * elle vide la file jusqu'à zéro en tranchant chaque fiche. Le bouton ouvre une conversation dédiée
 * et y ENVOIE la commande tout de suite (`send: true`) : le clic EST la validation, comme « Faire
 * réparer » de la mise à jour. Même chemin d'envoi existant (`autowin:prefill-conversation`).
 * Provider résolu depuis les RÔLES, jamais un défaut inventé ; sans provider on n'ouvre rien.
 */
async function promptCurate(pending: number): Promise<void> {
  const roleMap = await window.api.roles?.()
  const provider =
    roleMap?.orchestrator?.provider ??
    roleMap?.subagent?.provider ??
    (roleMap ? Object.values(roleMap)[0]?.provider : undefined)
  if (!provider) return
  const conversation = await window.api.conversationsCreate?.({
    // Le TITRE du fil s'affiche dans la liste : il suit la langue. La commande envoyée plus bas, elle,
    // est la consigne d'un agent et reste en français (conv-1170).
    title: traduireKnowledge('boite.curate.conversation', langueCourante()),
    category: provider,
    provider
  })
  if (!conversation?.id) return
  try {
    await window.api.appCommand?.('navigate', { tab: 'chat' })
  } catch {
    /* navigation refusée : le prompt reste préparé dans la conversation */
  }
  const prompt =
    pending > 0
      ? `/curate — vide la file d'attente du savoir (${pending} candidat${pending === 1 ? '' : 's'} en attente).`
      : `/curate — passe la file d'attente du savoir en revue.`
  window.dispatchEvent(
    new CustomEvent('autowin:prefill-conversation', {
      detail: { conversationId: conversation.id, prompt, send: true }
    })
  )
}

export function KnowledgeInboxPanel({
  brainPath,
  onIndexChangeStarted,
  onIndexChanged,
  onPendingCountChange
}: {
  brainPath: string
  onIndexChangeStarted?: () => void
  onIndexChanged?: (brainPath: string) => void | Promise<void>
  /**
   * Compte RELU par le panneau. La pastille du bouton ✦ ne lit la file qu'au chargement de la vue :
   * une curation faite hors écran (`/curate` en ligne de commande) la laissait à « 12 » pendant que
   * ce panneau affichait « 0 candidats » (constaté le 2026-10-06, conv-583). Le panneau porte la
   * lecture la plus fraîche : il la remonte pour qu'un seul chiffre s'affiche.
   */
  onPendingCountChange?: (count: number) => void
}): React.JSX.Element {
  const { t } = useTextesKnowledge()
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
  /** Vrai seulement après une lecture RÉUSSIE de ce brain : avant, `candidates` vaut [] par défaut. */
  const listReadRef = useRef(false)
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
    listReadRef.current = false
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
        listReadRef.current = true
        setCandidates(found)
        setError('')
      })
      .catch((cause) => {
        if (isCurrent())
          setError(
            brainBusinessError(traduireKnowledge('boite.erreur.charger', langueCourante()), cause)
          )
      })
      .finally(() => {
        if (isCurrent()) setLoading(false)
      })
  }, [brainPath])

  // Une lecture en cours ou en échec ne dit rien du compte : seule une liste effectivement lue (ou
  // réduite par une décision prise ici) est remontée.
  useEffect(() => {
    if (loading || error || !listReadRef.current) return
    onPendingCountChange?.(candidates.length)
  }, [candidates.length, error, loading, onPendingCountChange])

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
          const message = brainBusinessError(
            traduireKnowledge('boite.erreur.decision', langueCourante()),
            cause
          )
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
        const message = brainBusinessError(
          traduireKnowledge('boite.erreur.contenu', langueCourante()),
          cause
        )
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
    <section className="knowledge-inbox" aria-label={t('boite.aria')}>
      <header className="knowledge-inbox__head">
        <span>{t('boite.titre')}</span>
        <strong>
          {t(candidates.length === 1 ? 'boite.candidat' : 'boite.candidats', {
            n: candidates.length
          })}
        </strong>
        <button
          type="button"
          onClick={() => void promptCurate(candidates.length)}
          title={t('boite.curate.titre')}
        >
          {t('boite.curate.bouton')}
        </button>
        <button onClick={reload} disabled={!brainPath || loading}>
          {loading ? t('boite.lecture') : t('boite.actualiser')}
        </button>
      </header>

      {error && (
        <p className="knowledge-inbox__error" role="alert">
          <span>{error}</span>
          <button type="button" className="knowledge-inbox__retry" onClick={reload}>
            {t('commun.reessayer')}
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
              <Spinner /> {t('boite.index.enCours', { titre: indexState.title })}
            </>
          ) : indexState.action === 'promote' ? (
            t('boite.index.promue', { titre: indexState.title })
          ) : (
            t('boite.index.rejetee', { titre: indexState.title })
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
        <p className="knowledge-inbox__empty">{t('boite.vide')}</p>
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
                  <small>{ageLabel(candidate, t)}</small>
                  {twin && (
                    <span
                      className="knowledge-inbox__dup"
                      title={t('boite.doublon.titre', { id: twin.id })}
                    >
                      {t('boite.doublon', { pourcent: Math.round(twin.similarity * 100) })}
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
                          {t(SHA_STATE_LABELS[candidate.source.shaState])}
                        </span>
                        {candidate.source.problem && (
                          <em className="knowledge-inbox__source-problem">
                            {candidate.source.problem}
                          </em>
                        )}
                      </>
                    ) : (
                      <em className="knowledge-inbox__source-problem">{t('boite.aucuneSource')}</em>
                    )}
                  </dd>
                  {candidate.scope && (
                    <>
                      <dt>{t('boite.portee')}</dt>
                      <dd>{candidate.scope}</dd>
                    </>
                  )}
                  <dt>{t('boite.depose')}</dt>
                  <dd>{candidate.depositedAt ?? t('boite.dateInconnue')}</dd>
                </dl>

                {candidate.nearDuplicates.length > 0 && (
                  <div className="knowledge-inbox__twins" role="note">
                    <strong>{t('boite.jumeaux')}</strong>
                    <ul>
                      {candidate.nearDuplicates.map((duplicate) => (
                        <li key={duplicate.id}>
                          {duplicate.id}
                          <span>
                            {' — '}
                            {Math.round(duplicate.similarity * 100)} %
                            {` · ${t(
                              duplicate.zone === 'knowledge'
                                ? 'boite.jumeaux.canonique'
                                : 'boite.jumeaux.autre'
                            )}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    {candidate.nearDuplicatesOmitted && (
                      <small>
                        {t('boite.jumeaux.omis', {
                          inbox: candidate.nearDuplicatesOmitted.inbox,
                          knowledge: candidate.nearDuplicatesOmitted.knowledge
                        })}
                        {(candidate.nearDuplicatesOmitted.knowledge > 0 ||
                          candidate.nearDuplicates.some(({ zone }) => zone === 'knowledge')) &&
                          ` ${t('boite.jumeaux.meilleur')}`}
                      </small>
                    )}
                    <small>{t('boite.jumeaux.note')}</small>
                  </div>
                )}

                <pre className="knowledge-inbox__body">
                  {loadedBodies.get(candidate.id) ?? candidate.body}
                  {candidate.bodyTruncated && !loadedBodies.has(candidate.id) ? '…' : ''}
                </pre>
                {loadingBodies.has(candidate.id) && <small>{t('boite.corps.lecture')}</small>}
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
                    {t('boite.promouvoir')}
                  </button>
                  <button
                    className="is-reject"
                    disabled={busyIds.has(candidate.id)}
                    onClick={() => void decide(candidate, 'reject')}
                  >
                    {t('boite.rejeter')}
                  </button>
                  <small>
                    {/* Les deux dossiers restent des `<code>` : la phrase les porte en `{knowledge}` et
                        `{trash}`, remplacés ici par l'élément. */}
                    {t('boite.aide')
                      .split(/\{(knowledge|trash)\}/)
                      .map((morceau, rang) =>
                        rang % 2 === 1 ? (
                          <code key={rang}>
                            {morceau === 'knowledge' ? 'knowledge/' : '.trash/'}
                          </code>
                        ) : (
                          morceau
                        )
                      )}
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
