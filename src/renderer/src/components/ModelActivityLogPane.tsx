/**
 * SECTION « Logs » du panneau droit : la TRACE de ce que les modèles ont fait dans la conversation
 * ouverte — appel modèle, raisonnement, commande, verdict, artefact, erreur, fin de tour.
 *
 * Deux sources, fusionnées par `buildModelActivityLog` : le journal fichier du tour (le plus
 * complet, mais nettoyé après 7 jours) et les parts persistées du message (durables). Le composant
 * ne fait QUE : charger les journaux des tours affichés, et rendre le résultat du modèle pur.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Msg } from './chat-view-types'
import {
  buildModelActivityLog,
  type ModelActivityEntry,
  type ModelActivityKind
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
  event: 'Journal'
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
            const events = (await window.api.turnJournal?.(conversationId, turnId)) ?? []
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

  const entries = useMemo(
    () => buildModelActivityLog({ messages, journalByTurn }),
    [messages, journalByTurn]
  )
  const motif = filtre.trim().toLowerCase()
  const visibles = motif
    ? entries.filter((entry) =>
        `${entry.label} ${entry.detail ?? ''} ${KIND_LABEL[entry.kind]}`
          .toLowerCase()
          .includes(motif)
      )
    : entries

  // Le journal se lit par la FIN : l'activité récente est en bas, comme le fil.
  useEffect(() => {
    const node = listRef.current
    if (node) node.scrollTop = node.scrollHeight
  }, [visibles.length])

  return (
    <div className="col grow" style={{ minHeight: 0, gap: 'var(--s2)' }}>
      <input
        className="input"
        type="search"
        value={filtre}
        onChange={(event) => setFiltre(event.target.value)}
        placeholder="Filtrer les logs…"
        aria-label="Filtrer les logs"
        style={{ fontSize: 12 }}
      />
      <div
        ref={listRef}
        className="scroll-y col grow"
        data-testid="model-activity-log"
        style={{ minHeight: 0, gap: 4 }}
      >
        {visibles.length === 0 && (
          <div className="c-faint" style={{ fontSize: 12, padding: 'var(--s2)' }}>
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
      title={entry.turnId ? `tour ${entry.turnId}` : undefined}
      style={{ fontSize: 12, lineHeight: 1.35, padding: '3px 6px', borderRadius: 4 }}
    >
      <div className="row gap2" style={{ alignItems: 'center', minWidth: 0 }}>
        {dot ? <span className={`status-dot ${dot}`} /> : null}
        {heure(entry.at) ? (
          <time className="c-faint" style={{ fontSize: 10, fontVariantNumeric: 'tabular-nums' }}>
            {heure(entry.at)}
          </time>
        ) : null}
        <span className="c-faint" style={{ fontSize: 10, textTransform: 'uppercase' }}>
          {KIND_LABEL[entry.kind]}
        </span>
        <span
          style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}
        >
          {entry.label}
        </span>
      </div>
      {entry.detail ? (
        <div
          className="c-faint scroll-y"
          style={{
            fontSize: 11,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            // Le détail n'est plus tronqué (le journal doit contenir TOUT) : c'est la HAUTEUR
            // affichée qui est bornée, et la ligne défile pour livrer le reste.
            maxHeight: 220
          }}
        >
          {entry.detail}
        </div>
      ) : null}
    </div>
  )
}
