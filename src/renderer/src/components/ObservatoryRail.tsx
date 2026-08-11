import { lastUserMessagePreview } from './observatory-event-preview'
import type { ObservatoryPrioritySignal } from './observatory-priority-signals'
import type { ActivitySessionMeta, ConversationActivity } from './useObservatorySources'
import type { ActivitySession, ConversationItem, PromptCall } from './observatory-view-types'

/**
 * Rail gauche d'Observatory : conversations, appels observés, activité, transcripts, signaux.
 *
 * Extrait d'`ObservatoryView.tsx` (1594 lignes le 2026-08-11) SANS changement de comportement : ce
 * fichier ne contient que du RENDU. Tout l'état et toutes les décisions restent dans la vue, qui les
 * passe en props — la découpe rend visible ce que le rail affiche, sans déplacer une seule règle.
 */
export function ObservatoryRail({
  conversationQuery,
  onConversationQueryChange,
  conversationLimitStep,
  visibleConversations,
  filteredConversationCount,
  hiddenConversationCount,
  onShowMoreConversations,
  conversationId,
  onSelectConversation,
  callsLoading,
  currentCalls,
  selectedCallId,
  onSelectCall,
  conversationActivity,
  conversationActivityLoading,
  activitySessions,
  activitySessionsLoading,
  activitySession,
  onOpenSession,
  activityImage,
  onOpenImage,
  prioritySignals,
  onOpenSignal
}: {
  conversationQuery: string
  onConversationQueryChange: (value: string) => void
  conversationLimitStep: number
  visibleConversations: ConversationItem[]
  filteredConversationCount: number
  hiddenConversationCount: number
  onShowMoreConversations: () => void
  conversationId: string
  onSelectConversation: (conversationId: string) => void
  callsLoading: boolean
  currentCalls: PromptCall[]
  selectedCallId?: string
  onSelectCall: (call: PromptCall) => void
  conversationActivity: ConversationActivity[]
  conversationActivityLoading: boolean
  activitySessions: ActivitySessionMeta[]
  activitySessionsLoading: boolean
  activitySession: ActivitySession | null
  onOpenSession: (session: ActivitySessionMeta) => void
  activityImage: string
  onOpenImage: (path: string) => void
  prioritySignals: ObservatoryPrioritySignal[]
  onOpenSignal: (eventId: string) => void
}): React.JSX.Element {
  return (
    <aside className="observatory-rail">
      <span className="observatory-panel-title">conversations</span>
      <input
        className="observatory-conversation-filter"
        data-testid="observatory-conversation-filter"
        value={conversationQuery}
        onChange={(event) => onConversationQueryChange(event.target.value)}
        placeholder="Filtrer titre ou provider…"
        aria-label="Filtrer les conversations"
      />
      <small data-testid="observatory-conversation-count">
        {visibleConversations.length.toLocaleString('fr-FR')} /{' '}
        {filteredConversationCount.toLocaleString('fr-FR')} conversation
        {filteredConversationCount > 1 ? 's' : ''}
      </small>
      <div className="observatory-conversations">
        {visibleConversations.map((conversation) => (
          <button
            key={conversation.id}
            className={conversation.id === conversationId ? 'is-active' : ''}
            onClick={() => onSelectConversation(conversation.id)}
          >
            <strong>{conversation.title}</strong>
            <small>{conversation.provider}</small>
          </button>
        ))}
      </div>
      {hiddenConversationCount > 0 && (
        <button
          type="button"
          className="observatory-conversation-more"
          data-testid="observatory-conversation-more"
          onClick={onShowMoreConversations}
        >
          Afficher {Math.min(conversationLimitStep, hiddenConversationCount)} de plus ·{' '}
          {hiddenConversationCount.toLocaleString('fr-FR')} masquée
          {hiddenConversationCount > 1 ? 's' : ''}
        </button>
      )}
      <section className="observatory-calls" aria-busy={callsLoading}>
        <span className="observatory-panel-title">APPELS OBSERVÉS</span>
        {currentCalls.map((call) => (
          <button
            key={call.id}
            className={selectedCallId === call.id ? 'is-active' : ''}
            onClick={() => onSelectCall(call)}
          >
            <strong>
              {call.provider}
              {call.model ? ` · ${call.model}` : ''}
            </strong>
            {(() => {
              const preview = lastUserMessagePreview(call.messages)
              return preview ? (
                <span className="observatory-call-preview" title={preview}>
                  « {preview} »
                </span>
              ) : null
            })()}
            <small>
              {new Date(call.ts).toLocaleTimeString('fr-FR')} ·{' '}
              {(call.usage?.inputTokens ?? 0).toLocaleString('fr-FR')} in ·{' '}
              {(call.usage?.cacheReadTokens ?? 0).toLocaleString('fr-FR')} cache
            </small>
          </button>
        ))}
      </section>
      <section
        className="observatory-conversation-activity"
        data-testid="conversation-activity"
        aria-busy={conversationActivityLoading}
      >
        <span className="observatory-panel-title">ACTIVITÉ CONVERSATION</span>
        {conversationActivity.slice(-12).map((entry, index) => (
          <p key={`${entry.ts}:${entry.kind}:${index}`}>
            <strong>{entry.label}</strong>
            <small>{entry.kind}</small>
          </p>
        ))}
      </section>
      <section
        className="observatory-transcripts"
        data-testid="activity-transcripts"
        aria-busy={activitySessionsLoading}
      >
        <span className="observatory-panel-title">TRANSCRIPTS</span>
        {activitySessions.slice(0, 8).map((session) => (
          <button key={session.path} onClick={() => onOpenSession(session)}>
            <strong>{session.project}</strong>
            <small>{session.id}</small>
          </button>
        ))}
        {activitySession && (
          <div>
            <small>{activitySession.totalToolCalls} appels outil</small>
            {activitySession.turns.slice(-3).map((turn, index) => (
              <p key={`${turn.kind}:${index}`}>{turn.text}</p>
            ))}
            {activitySession.images
              .filter((image) => image.exists)
              .map((image) => (
                <button key={image.path} onClick={() => onOpenImage(image.path)}>
                  Voir image
                </button>
              ))}
            {activityImage && <img src={activityImage} alt="Capture du transcript" />}
          </div>
        )}
      </section>
      <section className="observatory-diagnostics">
        <span className="observatory-panel-title">SIGNAUX PRIORITAIRES</span>
        {prioritySignals.length === 0 ? (
          <p>Aucun signal évident.</p>
        ) : (
          prioritySignals.map((item) => (
            <button
              key={item.id}
              data-severity={item.severity}
              data-signal-id={item.eventId}
              onClick={() => onOpenSignal(item.eventId)}
            >
              <strong>
                {item.severityLabel} · {item.impact.toLocaleString('fr-FR')} caractères
              </strong>
              <span>
                {item.label}
                {item.turnIds.length > 0
                  ? ` · ${item.turnIds.length} tour${item.turnIds.length > 1 ? 's' : ''}`
                  : ''}
              </span>
            </button>
          ))
        )}
      </section>
    </aside>
  )
}
