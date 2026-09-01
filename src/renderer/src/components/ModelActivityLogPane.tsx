/**
 * SECTION « Logs » du panneau droit : la TRACE de ce que les modèles ont fait dans la conversation
 * ouverte — appel modèle, raisonnement, commande, verdict, artefact, erreur, fin de tour.
 *
 * Deux sources, fusionnées par `buildModelActivityLog` : le journal fichier du tour (le plus
 * complet, mais nettoyé après 7 jours) et les parts persistées du message (durables). Le composant
 * ne fait QUE : charger les journaux des tours affichés, et rendre le résultat du modèle pur.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import './ModelActivityLogPane.css'
import type { Msg } from './chat-view-types'
import {
  buildModelActivityLog,
  type ModelActivityEntry,
  type ModelActivityKind,
  type ModelActivitySource
} from './model-activity-log'

const KIND_LABEL: Record<ModelActivityKind, string> = {
  prompt: 'Demande',
  'model-call': 'Modèle',
  reasoning: 'Réflexion',
  text: 'Réponse',
  action: 'Action',
  artifact: 'Artefact',
  error: 'Erreur',
  done: 'Fin',
  injection: 'Injection',
  boundary: 'Frontière',
  usage: 'Coût',
  status: 'Signe de vie',
  event: 'Journal'
}

const SOURCE_LABEL: Record<ModelActivitySource, string> = {
  thread: 'fil',
  journal: 'journal',
  parts: 'persisté',
  causal: 'trace causale',
  activity: 'activité'
}

/** Heure locale HH:MM:SS — le journal n'écrit qu'un epoch, et parfois rien du tout. */
function heure(at?: number): string | null {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null
  return new Date(at).toLocaleTimeString('fr-FR', { hour12: false })
}

export type ModelActivityLogPaneProps = {
  conversationId: string | null
  messages: readonly Msg[]
  /** Un tour est en cours : on recharge les journaux pour suivre l'activité vivante. */
  live?: boolean
}

export function ModelActivityLogPane({
  conversationId,
  messages,
  live
}: ModelActivityLogPaneProps): React.JSX.Element {
  const [journalByTurn, setJournalByTurn] = useState<
    Record<string, ReadonlyArray<Record<string, unknown>>>
  >({})
  const [filtre, setFiltre] = useState('')
  // Les DEUX sources que ce panneau ignorait : la trace causale (ce qu'analysait l'Observatory) et
  // le journal d'activite facturee (provider, tokens, cout, duree).
  const [causal, setCausal] = useState<ReadonlyArray<Record<string, unknown>>>([])
  const [activity, setActivity] = useState<ReadonlyArray<Record<string, unknown>>>([])
  const [kindMasque, setKindMasque] = useState<ModelActivityKind | ''>('')
  const [sourceMasquee, setSourceMasquee] = useState<ModelActivitySource | ''>('')
  const listRef = useRef<HTMLDivElement | null>(null)

  // CLÉ des tours, et non le tableau `messages` : celui-ci change à CHAQUE fragment de stream, ce
  // qui relancerait la lecture des journaux des dizaines de fois par seconde.
  const turnKey = messages
    .filter((message) => message.role === 'assistant')
    .map((message) => (message as { turnId?: string }).turnId)
    .filter((turnId): turnId is string => Boolean(turnId))
    .join('|')

  // Chargement des journaux : à l'ouverture, quand la liste des tours change, et en boucle courte
  // tant qu'un tour est VIVANT (le journal est écrit au fil de l'eau côté main).
  useEffect(() => {
    if (!conversationId) return
    const turnIds = turnKey ? turnKey.split('|') : []
    let annule = false
    const charger = async (): Promise<void> => {
      const lecture = await Promise.all(
        turnIds.map(async (turnId) => {
          try {
            const events = (await window.api?.turnJournal?.(conversationId, turnId)) ?? []
            return [turnId, events] as const
          } catch {
            // Journal absent (nettoyé) : le tour reste tracé par ses parts durables.
            return [turnId, []] as const
          }
        })
      )
      if (annule) return
      setJournalByTurn(Object.fromEntries(lecture.filter(([, events]) => events.length > 0)))
    }
    void charger()
    if (!live)
      return () => {
        annule = true
      }
    const timer = setInterval(() => void charger(), 2_000)
    return () => {
      annule = true
      clearInterval(timer)
    }
  }, [conversationId, turnKey, live])

  // Trace causale et activite facturee sont scopees a la CONVERSATION (pas au tour) : une seule
  // lecture, rejouee tant qu'un tour est vivant.
  useEffect(() => {
    // Pas de reinitialisation ICI : un `setState` synchrone dans un effet cascade les rendus. Sans
    // conversation il n'y a rien a lire, et l'affichage derive de `conversationId` plus bas.
    if (!conversationId) return
    let annule = false
    const charger = async (): Promise<void> => {
      const [trace, activite] = await Promise.all([
        window.api?.causalTrace?.(conversationId).catch(() => []) ?? [],
        window.api?.conversationActivity?.(conversationId).catch(() => []) ?? []
      ])
      if (annule) return
      setCausal((trace ?? []) as ReadonlyArray<Record<string, unknown>>)
      setActivity((activite ?? []) as ReadonlyArray<Record<string, unknown>>)
    }
    void charger()
    if (!live)
      return () => {
        annule = true
      }
    const timer = setInterval(() => void charger(), 4_000)
    return () => {
      annule = true
      clearInterval(timer)
    }
  }, [conversationId, turnKey, live])

  const entries = useMemo(
    () =>
      buildModelActivityLog({
        messages,
        journalByTurn,
        // DERIVE, pas remis a zero par un effet : sans conversation, ces deux sources n'existent pas.
        causal: conversationId ? causal : [],
        activity: conversationId ? activity : []
      }),
    [messages, journalByTurn, causal, activity, conversationId]
  )
  const motif = filtre.trim().toLowerCase()
  const visibles = entries.filter((entry) => {
    if (kindMasque && entry.kind !== kindMasque) return false
    if (sourceMasquee && entry.source !== sourceMasquee) return false
    if (!motif) return true
    return `${entry.label} ${entry.detail ?? ''} ${KIND_LABEL[entry.kind]} ${SOURCE_LABEL[entry.source]}`
      .toLowerCase()
      .includes(motif)
  })
  // Les listes de filtres viennent des lignes REELLEMENT presentes : jamais une categorie vide.
  const kindsPresents = [...new Set(entries.map((entry) => entry.kind))]
  const sourcesPresentes = [...new Set(entries.map((entry) => entry.source))]

  // Le journal se lit par la FIN : l'activité récente est en bas, comme le fil.
  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [visibles.length])

  return (
    <div className="col grow model-log" style={{ minHeight: 0, gap: 'var(--s2)' }}>
      <div className="model-log-filter">
        <input
          className="input"
          type="search"
          value={filtre}
          onChange={(event) => setFiltre(event.target.value)}
          placeholder="Filtrer les logs…"
          aria-label="Filtrer les logs"
        />
        <select
          className="input"
          aria-label="Filtrer par nature"
          value={kindMasque}
          onChange={(event) => setKindMasque(event.target.value as ModelActivityKind | '')}
        >
          <option value="">Tout</option>
          {kindsPresents.map((kind) => (
            <option key={kind} value={kind}>
              {KIND_LABEL[kind]}
            </option>
          ))}
        </select>
        <select
          className="input"
          aria-label="Filtrer par source"
          value={sourceMasquee}
          onChange={(event) => setSourceMasquee(event.target.value as ModelActivitySource | '')}
        >
          <option value="">Toutes sources</option>
          {sourcesPresentes.map((source) => (
            <option key={source} value={source}>
              {SOURCE_LABEL[source]}
            </option>
          ))}
        </select>
        {/* Le compte dit ce que le filtre a retenu SUR le total : sans lui, un filtre trop etroit
            ressemble a un journal vide. */}
        {entries.length > 0 && (
          <span className="model-log-count">
            {visibles.length === entries.length
              ? `${entries.length}`
              : `${visibles.length}/${entries.length}`}
          </span>
        )}
      </div>
      <div
        ref={listRef}
        className="scroll-y col grow model-log-list"
        data-testid="model-activity-log"
        style={{ minHeight: 0 }}
      >
        {visibles.length === 0 && (
          <div className="model-log-empty">
            {conversationId
              ? 'Aucune activité modèle tracée pour l’instant — chaque appel, commande, verdict et artefact s’inscrira ici.'
              : 'Sélectionne une conversation pour lire ce que les modèles y ont fait.'}
          </div>
        )}
        {visibles.map((entry) => (
          <LogRow key={entry.id} entry={entry} />
        ))}
      </div>
    </div>
  )
}

function LogRow({ entry }: { entry: ModelActivityEntry }): React.JSX.Element {
  const dot =
    entry.ok === false
      ? 'st-err'
      : entry.ok === true
        ? 'st-ok'
        : entry.kind === 'error'
          ? 'st-err'
          : ''
  return (
    <div
      className="model-log-row"
      data-log-kind={entry.kind}
      data-log-ok={entry.ok === undefined ? undefined : String(entry.ok)}
      title={entry.turnId ? `tour ${entry.turnId}` : undefined}
    >
      <time className="model-log-time">{heure(entry.at) ?? '—'}</time>
      <div className="model-log-body">
        <div className="model-log-head">
          {dot ? <span className={`status-dot ${dot}`} /> : null}
          <span className="model-log-kind">{KIND_LABEL[entry.kind]}</span>
          <span className="model-log-source" data-log-source={entry.source}>
            {SOURCE_LABEL[entry.source]}
          </span>
          <span className="model-log-label">{entry.label}</span>
        </div>
        {entry.detail ? (
          <details className="model-log-detail">
            {/* Le detail ENTIER vit dans le summary, clampe a deux lignes par le CSS et declampe
                a l'ouverture : le texte n'est donc jamais duplique ni tronque pour de bon. */}
            <summary>{entry.detail}</summary>
            <span className="model-log-more" aria-hidden="true" />
          </details>
        ) : null}
      </div>
    </div>
  )
}
