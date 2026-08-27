/**
 * PANNEAU « Réflexion » — le raisonnement du modèle hors du fil.
 *
 * Avant : le raisonnement n'apparaissait que TRANSITOIREMENT dans la bulle, pendant les secondes
 * d'attente, puis disparaissait dès le premier mot de réponse (`ChatMessageRow`, condition
 * `!message.done`). Il polluait le fil ET restait illisible.
 *
 * Ici il vit dans une colonne dédiée, à droite : conservé pour toute la session de la conversation,
 * le dernier bloc en cours signalé « en direct ».
 */
import React from 'react'
import type { Msg } from './chat-view-types'

export interface ReasoningEntry {
  key: string
  reasoning: string
  live: boolean
}

/** Extrait, dans l'ordre du fil, le raisonnement des messages assistant qui en portent un. */
export function collectReasoningEntries(messages: Msg[]): ReasoningEntry[] {
  const entries: ReasoningEntry[] = []
  messages.forEach((message, index) => {
    if (message.role !== 'assistant') return
    const reasoning = (message as { reasoning?: string }).reasoning
    if (!reasoning || !reasoning.trim()) return
    entries.push({
      key: message.messageId ?? `idx-${index}`,
      reasoning,
      live: message.done !== true
    })
  })
  return entries
}

export function ThinkingPanel({
  messages,
  onClose,
  width
}: {
  messages: Msg[]
  onClose: () => void
  width?: number
}): React.JSX.Element {
  const entries = collectReasoningEntries(messages)
  return (
    <aside
      className="lisere-dessus thinking-pane"
      data-testid="thinking-panel"
      aria-label="Réflexion de l’agent"
      style={width ? { width: `${width}px` } : undefined}
    >
      <header className="thinking-pane-head">
        <b>Réflexion</b>
        <button type="button" onClick={onClose} aria-label="Fermer le panneau de réflexion">
          ×
        </button>
      </header>
      <div className="thinking-pane-body">
        {entries.length === 0 ? (
          <p className="c-faint" data-testid="thinking-empty">
            Aucun raisonnement pour cette conversation. Il apparaîtra ici pendant le prochain tour.
          </p>
        ) : (
          entries.map((entry, index) => (
            <section key={entry.key} className={`thinking-block${entry.live ? ' is-live' : ''}`}>
              <span className="thinking-block-label">
                tour {index + 1}
                {entry.live ? ' · en direct' : ''}
              </span>
              <p>{entry.reasoning}</p>
            </section>
          ))
        )}
      </div>
    </aside>
  )
}
