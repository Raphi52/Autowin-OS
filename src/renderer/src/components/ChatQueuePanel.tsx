/**
 * Panneau de la FILE D'ATTENTE du chat, extrait de `ChatView.tsx` (levier « découpe »).
 *
 * Purement PRÉSENTATIONNEL : il reçoit la file et les actions, il ne détient aucun état et ne
 * connaît pas l'IPC. Le JSX est déplacé À L'IDENTIQUE (mêmes classes, mêmes libellés, mêmes
 * conditions d'affichage) — seuls les accès à la closure deviennent des props.
 */
import React from 'react'
import { canMoveQueueEntry } from './chat-queue-order'
import type { QueuedDirective } from './chat-view-types'

export function ChatQueuePanel({
  pendingDirectives,
  busy,
  interrupting,
  steeringDirectives,
  interruptAndFlushQueue,
  steerWithoutInterrupt,
  moveQueuedMessage,
  moveQueuedMessageToBtw,
  restoreQueuedMessageToDraft
}: {
  pendingDirectives: QueuedDirective[]
  busy: boolean
  /** La conversation active est-elle en cours d'interruption ? */
  interrupting: boolean
  steeringDirectives: Set<number>
  interruptAndFlushQueue: () => void
  steerWithoutInterrupt: (entry: QueuedDirective) => void
  moveQueuedMessage: (entry: QueuedDirective, delta: -1 | 1) => void
  moveQueuedMessageToBtw: (entry: QueuedDirective) => void
  restoreQueuedMessageToDraft: (entry: QueuedDirective) => void
}): React.JSX.Element | null {
  if (pendingDirectives.length === 0) return null
  return (
    <div className="directive-queue" aria-label="Messages en attente">
      <div className="directive-queue-head">
        <span className="directive-queue-title">
          ⚡ File d’attente · {pendingDirectives.length}
        </span>
        <span className="directive-queue-hint">envoyés un par un à la fin du tour en cours</span>
        {busy && (
          <button
            type="button"
            className="directive-queue-send directive-queue-send-all"
            title="Interrompre le tour en cours et envoyer tous les messages en file maintenant"
            aria-label="Interrompre et envoyer tout"
            disabled={interrupting}
            onClick={interruptAndFlushQueue}
          >
            {interrupting ? (
              <>
                <span className="spinner" aria-hidden="true" /> Interruption…
              </>
            ) : (
              '⏹ Interrompre et envoyer tout'
            )}
          </button>
        )}
      </div>
      {pendingDirectives.map((directive, index) => (
        <div className="directive-queue-item" key={directive.id}>
          <span className="directive-queue-index">{index + 1}</span>
          {/* L'ordre de la file était figé à l'ordre de frappe : un message urgent tapé en
                    dernier partait en dernier. ↑/↓ le corrigent, sans toucher aux `btw`. */}
          <button
            type="button"
            className="directive-queue-move"
            data-testid="queue-move-up"
            title="Remonter dans la file"
            aria-label={`Remonter le message ${index + 1}`}
            disabled={!canMoveQueueEntry(pendingDirectives, directive.id, -1)}
            onClick={() => moveQueuedMessage(directive, -1)}
          >
            ↑
          </button>
          <button
            type="button"
            className="directive-queue-move"
            data-testid="queue-move-down"
            title="Descendre dans la file"
            aria-label={`Descendre le message ${index + 1}`}
            disabled={!canMoveQueueEntry(pendingDirectives, directive.id, 1)}
            onClick={() => moveQueuedMessage(directive, 1)}
          >
            ↓
          </button>
          <span className="directive-queue-text" title={directive.text}>
            {directive.text}
          </span>
          {/* Hors tour actif il n'y a RIEN à interrompre : afficher le bouton donnait un clic
                    mort qui figeait la file sur « Interruption… ». La file se draine alors seule. */}
          {busy && (
            <button
              type="button"
              className="directive-queue-send"
              title="Interrompre le tour en cours et envoyer la file maintenant, en commençant par ce message"
              aria-label={`Interrompre et envoyer à partir du message ${index + 1}`}
              disabled={interrupting}
              onClick={interruptAndFlushQueue}
            >
              {interrupting ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Interruption…
                </>
              ) : (
                '⏹ Interrompre et envoyer'
              )}
            </button>
          )}
          {busy && (
            <button
              type="button"
              className="directive-queue-steer"
              title="Orienter maintenant — injecter ce message comme directive PRIORITAIRE dans le tour en cours, sans l’interrompre"
              aria-label={`Orienter le tour en cours avec le message ${index + 1}`}
              disabled={steeringDirectives.has(directive.id)}
              onClick={() => steerWithoutInterrupt(directive)}
            >
              {steeringDirectives.has(directive.id) ? (
                <>
                  <span className="spinner" aria-hidden="true" /> Orientation…
                </>
              ) : (
                '🧭 Orienter'
              )}
            </button>
          )}
          {busy && (
            <button
              type="button"
              className="directive-queue-send directive-queue-btw"
              title={
                directive.mode === 'btw'
                  ? 'BTW confirmé — ce message reste en dernier : il partira après les autres messages en file, y compris ceux tapés ensuite'
                  : 'BTW — remettre ce message à la fin de la file sans interrompre le tour en cours'
              }
              aria-label={`Remettre le message ${index + 1} en file via BTW`}
              disabled={directive.mode === 'btw'}
              onClick={() => moveQueuedMessageToBtw(directive)}
            >
              {directive.mode === 'btw' ? '✓ BTW' : 'BTW'}
            </button>
          )}
          <button
            type="button"
            className="directive-queue-remove"
            title="Retirer de la file"
            aria-label={`Retirer le message ${index + 1}`}
            onClick={() => restoreQueuedMessageToDraft(directive)}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
