export type ConversationAuthorityMode = 'plan' | 'ask' | 'auto'
export type CommandAuthority = 'automatic' | 'sensitive' | 'destructive'
export type CapabilityDecision = 'allow' | 'confirm' | 'deny'

export interface ConversationCapabilityRequest {
  mode: ConversationAuthorityMode
  mutates: boolean
  authority: CommandAuthority
}

export function decideConversationCapability(
  request: ConversationCapabilityRequest
): CapabilityDecision {
  if (!request.mutates) return 'allow'
  if (request.mode === 'plan') return 'deny'
  if (request.authority === 'destructive') return 'confirm'
  if (request.mode === 'ask' && request.authority === 'sensitive') return 'confirm'
  return 'allow'
}
