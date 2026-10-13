import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { GestesDesTours, GestesDuTour } from '../../../shared/gestes-agent'
import type { Msg } from './chat-view-types'
import { statusLabel } from './execution-interrupted-status'
import { buildHarnessTimelineFromTrace, type HarnessTraceEvent } from './harness-timeline-model'
import { LatestRequestGate } from './observatory-reliability'
import {
  FAMILY_CHAPTER,
  FAMILY_SHORT,
  buildRequestThread,
  liveStoryFromMessages,
  nativeGestureCount,
  withNativeActions,
  type LiveStory,
  type RequestStory,
  type StoryFamily
} from './request-thread-model'
import { Spinner } from './Spinner'
import { WorkflowExecutionGraph, type ExecutionNodeSelection } from './WorkflowExecutionGraph'
import './RequestThread.css'

/**
 * LE FIL DES DEMANDES — onglet « Graph » du panneau de droite (refonte du 2026-10-12, « 1 + 2 »).
 *
 * Toutes les demandes de la conversation, la plus récente en haut, chacune avec son état, sa durée
 * et son coût ; un clic la raconte en cinq chapitres (Demande, Décision, Ce qu'il a fait, Résultat,
 * Bilan). La demande EN COURS est lue dans le flux du chat, parce que l'agent n'écrit ses étapes
 * dans la trace qu'à la fin de son appel. L'arbre causal d'avant reste accessible au fond du récit,
 * comme détail (prompts, pensée des sous-agents, dépôt du run).
 */

interface RequestThreadProps {
  conversationId?: string
  active?: boolean
  live?: boolean
  messages?: readonly Msg[]
  requestLabel?: string
  onSelect?: (selection: ExecutionNodeSelection | null) => void
}

const LIVE_KEY = 'demande-en-cours'

function lecturesAllegeesDisponibles(): boolean {
  return (
    typeof window.api?.causalTraceGraphe === 'function' &&
    typeof window.api?.causalTraceCharges === 'function'
  )
}

function formatDuration(ms: number | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return 'durée inconnue'
  if (ms < 1000) return `${Math.round(ms)} ms`
  const seconds = ms / 1000
  if (seconds < 60)
    return `${new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 }).format(seconds)} s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} min ${String(Math.round(seconds % 60)).padStart(2, '0')} s`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`
}

function formatCost(usd: number | undefined): string | undefined {
  if (usd == null || !Number.isFinite(usd)) return undefined
  if (usd > 0 && usd < 0.01) return '< 0,01 $'
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(usd)} $`
}

/** « Lu ×9 », « Modifié ×34 »… : un morceau par famille, pour qu'aucun ne soit coupé en deux. */
function familyPieces(
  families: ReadonlyArray<{ family: StoryFamily['family']; count: number }>
): string[] {
  return families.map((family) => `${FAMILY_SHORT[family.family]} ×${family.count}`)
}

/**
 * LA LIGNE DE RÉSUMÉ D'UNE DEMANDE, EN MORCEAUX INSÉCABLES. Elle tenait sur une seule ligne coupée
 * en bout : dans le panneau de 388 px, « Lancé ×26 » disparaissait derrière des points de
 * suspension. Chaque morceau (date, famille de gestes, issue) reste entier, la ligne ne se brise
 * qu'ENTRE deux morceaux, sur deux lignes au plus (`RequestThread.css`). Panneau large : tout tient
 * sur une ligne, rien ne change.
 */
function ResumePieces({ pieces }: { pieces: string[] }): React.JSX.Element {
  return (
    <>
      {pieces.map((piece, index) => (
        <span key={`${index}-${piece}`}>
          {index > 0 && ' · '}
          <span className="request-row-piece">{piece}</span>
        </span>
      ))}
    </>
  )
}

/**
 * Gestes propres de l'agent de TOUTES les demandes, résumés par l'app en un appel. Une panne ou une
 * app plus ancienne sans ce canal rend `{}` : le fil garde alors les gestes de la trace, sans casser.
 */
async function lireGestesDesTours(conversationId: string): Promise<GestesDesTours> {
  if (typeof window.api?.turnJournalGestes !== 'function') return {}
  try {
    const gestes = await window.api.turnJournalGestes(conversationId)
    return gestes && typeof gestes === 'object' ? gestes : {}
  } catch {
    return {}
  }
}

/** La trace de la conversation, relue à chaque écriture, chaque seconde en direct, et à la fin du tour. */
function useRequestStories(
  conversationId: string | undefined,
  active: boolean,
  live: boolean
): {
  stories: RequestStory[]
  gestes: GestesDesTours
  loading: boolean
  error: string | null
} {
  const [stories, setStories] = useState<RequestStory[]>([])
  const [gestes, setGestes] = useState<GestesDesTours>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const gate = useRef(new LatestRequestGate())
  const previousLive = useRef(live)
  // Lu au moment du chargement, sans faire du mode direct une dépendance du chargement : basculer
  // en direct ne doit pas vider le fil pour le recharger avec l'écran d'attente.
  const liveRef = useRef(live)
  useEffect(() => {
    liveRef.current = live
  })

  const load = useCallback(
    async (showLoading: boolean): Promise<void> => {
      if (!active || !conversationId) return
      const requestId = gate.current.begin()
      if (showLoading) {
        setStories([])
        setGestes({})
        setLoading(true)
        setError(null)
      }
      try {
        const [trace, gestesLus] = await Promise.all([
          (lecturesAllegeesDisponibles()
            ? window.api.causalTraceGraphe(conversationId)
            : window.api.causalTrace(conversationId)) as Promise<HarnessTraceEvent[]>,
          lireGestesDesTours(conversationId)
        ])
        if (!gate.current.isCurrent(requestId)) return
        const timeline = buildHarnessTimelineFromTrace(Array.isArray(trace) ? trace : [])
        setStories(buildRequestThread(timeline, { live: liveRef.current }))
        setGestes(gestesLus)
        setError(null)
      } catch (reason) {
        if (!gate.current.isCurrent(requestId)) return
        setStories([])
        setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (gate.current.isCurrent(requestId)) setLoading(false)
      }
    },
    [active, conversationId]
  )

  useEffect(() => {
    const current = gate.current
    if (!active || !conversationId) {
      current.invalidate()
      return
    }
    let cancelled = false
    queueMicrotask(() => {
      if (!cancelled) void load(true)
    })
    return () => {
      cancelled = true
      current.invalidate()
    }
  }, [active, conversationId, load])

  useEffect(() => {
    if (!active || !live || !conversationId) return
    const timer = window.setInterval(() => void load(false), 1000)
    return () => window.clearInterval(timer)
  }, [active, conversationId, live, load])

  useEffect(() => {
    const wasLive = previousLive.current
    previousLive.current = live
    if (active && conversationId && wasLive && !live) void load(false)
  }, [active, conversationId, live, load])

  useEffect(() => {
    if (!active || !conversationId || typeof window.api?.onAppEvent !== 'function') return
    return window.api.onAppEvent((event) => {
      if (
        (event.type === 'orchestrate-usage' || event.type === 'causal-trace-updated') &&
        event.convId === conversationId
      )
        void load(false)
    })
  }, [active, conversationId, load])

  return { stories, gestes, loading, error }
}

/** Titre de survol de la ligne : combien de gestes viennent de l'agent lui-même. */
function gesturesTitle(gestes: GestesDuTour | undefined): string | undefined {
  const count = nativeGestureCount(gestes)
  return count > 0
    ? `Dont ${count} geste${count > 1 ? 's' : ''} de l’agent (lectures, commandes, éditions)`
    : undefined
}

function FamiliesChapter({ families }: { families: StoryFamily[] }): React.JSX.Element {
  if (families.length === 0)
    return <p className="request-story-empty">Aucun geste enregistré pour cette demande.</p>
  return (
    <ul className="request-story-families">
      {families.map((family) => (
        <li key={family.family} data-family={family.family}>
          <span className="request-story-family-name">{FAMILY_CHAPTER[family.family]}</span>
          <span className="request-story-family-actions">
            {family.actions.map((action, index) => (
              <span
                key={action.title}
                className={
                  action.status === 'failed'
                    ? 'request-story-action is-failed'
                    : 'request-story-action'
                }
              >
                {index > 0 && <span aria-hidden="true"> · </span>}
                {action.title}
                {action.count > 1 && <b> ×{action.count}</b>}
              </span>
            ))}
            {family.durationMs != null && (
              <span className="request-story-figure"> · {formatDuration(family.durationMs)}</span>
            )}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Chapter({
  name,
  children
}: {
  name: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="request-story-chapter" data-chapter={name}>
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function RequestStoryView({
  story,
  conversationId,
  requestLabel,
  onSelect
}: {
  story: RequestStory
  conversationId: string
  requestLabel?: string
  onSelect?: (selection: ExecutionNodeSelection | null) => void
}): React.JSX.Element {
  // `story.families` porte déjà les gestes propres de l'agent (fusionnés par `RequestThread`).
  const families = story.families
  const [treeOpen, setTreeOpen] = useState(false)
  const cost = formatCost(story.costUsd)
  return (
    <div className="request-story" data-request-story={story.turnId}>
      {story.failure && (
        <p className="request-story-failure" role="alert" data-request-failure>
          {story.failure}
        </p>
      )}
      <dl>
        <Chapter name="Demande">
          {story.text ? <b>« {story.text} »</b> : <b>Demande sans texte identifiable</b>}
          {story.dateLabel && <span className="request-story-figure"> · {story.dateLabel}</span>}
        </Chapter>
        <Chapter name="Décision">{story.decision.join(' · ')}</Chapter>
        <Chapter name="Ce qu’il a fait">
          <FamiliesChapter families={families} />
        </Chapter>
        <Chapter name="Résultat">
          <span className={story.status === 'failed' ? 'is-failed' : undefined}>
            {story.outcome.join(' · ')}
          </span>
        </Chapter>
        <Chapter name="Bilan">
          <b>{formatDuration(story.durationMs)}</b>
          {cost && <b> · {cost}</b>}
          <span className="request-story-figure"> · {statusLabel(story.status)}</span>
        </Chapter>
      </dl>
      <details
        className="request-story-tree"
        onToggle={(event) => setTreeOpen((event.currentTarget as HTMLDetailsElement).open)}
      >
        <summary>Arbre détaillé (prompts, pensée des agents, dépôt)</summary>
        {treeOpen && (
          <WorkflowExecutionGraph
            conversationId={conversationId}
            active
            turnId={story.turnId}
            requestLabel={requestLabel}
            onSelect={onSelect}
          />
        )}
      </details>
    </div>
  )
}

/** Familles de la demande en cours : ses commandes d'Autowin, plus les gestes propres de l'agent. */
function liveFamilies(story: LiveStory, gestes: GestesDuTour | undefined): StoryFamily[] {
  return withNativeActions(
    story.families.map((family) => ({
      family: family.family,
      count: family.count,
      actions: story.actions
        .filter((action) => action.family === family.family)
        .map((action) => ({
          title: action.title,
          count: 1,
          status:
            action.state === 'failed'
              ? 'failed'
              : action.state === 'running'
                ? 'running'
                : 'completed'
        }))
    })),
    gestes
  )
}

function LiveStoryView({
  story,
  families
}: {
  story: LiveStory
  families: StoryFamily[]
}): React.JSX.Element {
  return (
    <div className="request-story" data-request-story={LIVE_KEY}>
      <dl>
        <Chapter name="Demande">
          <b>« {story.text} »</b>
        </Chapter>
        <Chapter name="Maintenant">
          {story.heartbeat ? (
            <span className="request-live-heartbeat">{story.heartbeat}</span>
          ) : (
            'Le modèle réfléchit…'
          )}
        </Chapter>
        <Chapter name="Ce qu’il a fait">
          <FamiliesChapter families={families} />
        </Chapter>
        <Chapter name="Bilan">
          <b>{formatDuration(story.elapsedMs)}</b>
          <span className="request-story-figure"> · en cours, le coût arrive à la fin</span>
        </Chapter>
      </dl>
    </div>
  )
}

export function RequestThread({
  conversationId,
  active = true,
  live = false,
  messages = [],
  requestLabel,
  onSelect
}: RequestThreadProps): React.JSX.Element {
  const {
    stories: storiesFromTrace,
    gestes,
    loading,
    error
  } = useRequestStories(conversationId, active, live)
  // Chaque demande reçoit les gestes propres de l'agent que l'app a résumés depuis son journal.
  const stories = useMemo(
    () =>
      storiesFromTrace.map((story) =>
        gestes[story.turnId]
          ? { ...story, families: withNativeActions(story.families, gestes[story.turnId]) }
          : story
      ),
    [storiesFromTrace, gestes]
  )
  // L'horloge de la demande en cours : un battement par seconde, seulement en direct.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!live) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [live])
  const liveStory = useMemo(
    () => (live ? liveStoryFromMessages(messages, now) : undefined),
    [live, messages, now]
  )
  // La trace partielle de la demande en cours (pièces jointes, premiers outils) ferait doublon
  // avec la ligne vivante : elle est masquée tant que la demande tourne.
  const shownStories = useMemo(() => {
    const start = liveStory?.startedAt
    if (!liveStory || start == null) return stories
    return stories.filter((story) => {
      const at = Date.parse(story.ts)
      return !(Number.isFinite(at) && at >= start - 1000)
    })
  }, [stories, liveStory])
  const liveGestes = liveStory?.turnId ? gestes[liveStory.turnId] : undefined
  const liveFamilyList = useMemo(
    () => (liveStory ? liveFamilies(liveStory, liveGestes) : []),
    [liveStory, liveGestes]
  )
  const [opened, setOpened] = useState<{ convId?: string; key: string | null } | null>(null)
  const defaultKey = liveStory ? LIVE_KEY : (shownStories[0]?.turnId ?? null)
  const openKey = opened && opened.convId === conversationId ? opened.key : defaultKey
  const toggle = (key: string): void =>
    setOpened({ convId: conversationId, key: openKey === key ? null : key })

  if (!conversationId) {
    return (
      <div className="request-thread-empty">
        Sélectionne une conversation pour voir ses demandes.
      </div>
    )
  }

  const count = shownStories.length + (liveStory ? 1 : 0)
  return (
    <section
      className="request-thread"
      data-conversation-id={conversationId}
      aria-label="Fil des demandes"
      aria-busy={loading}
    >
      <header className="request-thread-head">
        <strong>Demandes</strong>
        <span>
          {count} demande{count > 1 ? 's' : ''}
          {live ? ' · en direct' : ''}
        </span>
      </header>
      {loading && count === 0 && (
        <div className="request-thread-empty" role="status">
          <Spinner />
          Chargement des demandes…
        </div>
      )}
      {!loading && error && (
        <div className="request-thread-error" role="alert">
          Demandes indisponibles · {error}
        </div>
      )}
      {!loading && !error && count === 0 && (
        <div className="request-thread-empty">Aucune demande tracée dans cette conversation.</div>
      )}
      {count > 0 && (
        <ol className="request-thread-list">
          {liveStory && (
            <li
              className="request-row-item is-running"
              data-request-row={LIVE_KEY}
              data-status="running"
            >
              <button
                type="button"
                className="request-row"
                aria-expanded={openKey === LIVE_KEY}
                onClick={() => toggle(LIVE_KEY)}
              >
                <span className="request-row-dot" aria-hidden="true" />
                <span className="request-row-text">{liveStory.text || 'Demande en cours'}</span>
                <span className="request-row-figures">
                  <b>en cours</b> · {formatDuration(liveStory.elapsedMs)}
                </span>
                <span
                  className="request-row-mini"
                  title={gesturesTitle(liveGestes)}
                  data-native-gestures={nativeGestureCount(liveGestes)}
                >
                  <ResumePieces
                    pieces={[
                      ...familyPieces(liveFamilyList),
                      liveStory.heartbeat ?? 'Le modèle réfléchit…'
                    ]}
                  />
                </span>
              </button>
              {openKey === LIVE_KEY && (
                <LiveStoryView story={liveStory} families={liveFamilyList} />
              )}
            </li>
          )}
          {shownStories.map((story) => {
            const cost = formatCost(story.costUsd)
            // Les gestes passent juste après la date : la ligne est coupée en bout dans un panneau
            // étroit, et le nombre de lectures, commandes et éditions est ce qu'on y cherche.
            const resume = [
              story.dateLabel,
              ...familyPieces(story.families),
              story.failedCalls > 0 && story.status === 'completed'
                ? `${story.failedCalls} échec repris`
                : '',
              story.outcome[0],
              story.calls > 1 ? `${story.calls} appels` : ''
            ].filter(Boolean)
            const storyGestes = gestes[story.turnId]
            return (
              <li
                key={story.turnId}
                className={`request-row-item is-${story.status}`}
                data-request-row={story.turnId}
                data-status={story.status}
              >
                <button
                  type="button"
                  className="request-row"
                  aria-expanded={openKey === story.turnId}
                  onClick={() => toggle(story.turnId)}
                >
                  <span className="request-row-dot" aria-hidden="true" />
                  <span className="request-row-text">
                    {story.text || `Demande du ${story.dateLabel || 'jour inconnu'}`}
                  </span>
                  <span className="request-row-figures">
                    <b>{statusLabel(story.status)}</b> · {formatDuration(story.durationMs)}
                    {cost && ` · ${cost}`}
                  </span>
                  <span
                    className="request-row-mini"
                    title={gesturesTitle(storyGestes)}
                    data-native-gestures={nativeGestureCount(storyGestes)}
                  >
                    <ResumePieces pieces={resume} />
                  </span>
                </button>
                {openKey === story.turnId && (
                  <RequestStoryView
                    story={story}
                    conversationId={conversationId}
                    requestLabel={requestLabel}
                    onSelect={onSelect}
                  />
                )}
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
