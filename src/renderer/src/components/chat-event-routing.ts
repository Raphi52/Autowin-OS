export interface ScopedAppEvent {
  type: string
  scope?: string
  convId?: string
}

/** Un refresh chat ne doit jamais recharger une autre conversation que sa cible. */
export function refreshesActiveConversation(
  event: ScopedAppEvent,
  activeConversationId: string | null
): boolean {
  return (
    event.type === 'refresh' &&
    event.scope === 'chat' &&
    Boolean(activeConversationId) &&
    (!event.convId || event.convId === activeConversationId)
  )
}

export function isLiveOrchestrationEvent(event: ScopedAppEvent): boolean {
  return event.type.startsWith('orchestrate-') && Boolean(event.convId)
}
