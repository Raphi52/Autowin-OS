export interface ChatActionPart {
  kind: 'action'
  name: string
  args?: unknown
  ok?: boolean
  data?: unknown
}

export interface ChatTextPart {
  kind: 'text'
  text: string
}

export type ChatPart = ChatTextPart | ChatActionPart

interface RuntimeSlot {
  slotId?: string
  provider: string
  modelId: string
  reasoningEffort: string
}

interface RuntimeTopology {
  orchestrator: RuntimeSlot
}

interface RuntimeModel {
  id: string
  provider: string
  model: string
  label?: string
}

export interface ChatRuntimeIdentity {
  provider: string
  model: string
  modelLabel: string
  reasoningEffort: string
}

export const CHAT_PANE_LIMITS = {
  conversations: { min: 224, max: 480 },
  workflows: { min: 280, max: 760 }
} as const

export function resolveChatRuntimeIdentity(
  topology: RuntimeTopology,
  models: RuntimeModel[]
): ChatRuntimeIdentity {
  const slot = topology.orchestrator
  const imported = models.find(
    (model) => model.id === slot.modelId && model.provider === slot.provider
  )
  return {
    provider: slot.provider,
    model: imported?.model ?? slot.modelId,
    modelLabel: imported?.label?.trim() || imported?.model || slot.modelId,
    reasoningEffort: slot.reasoningEffort
  }
}

export function coalesceAssistantParts(parts: ChatPart[]): ChatPart[] {
  const compact: ChatPart[] = []
  for (const part of parts) {
    if (part.kind === 'action') {
      compact.push(part)
      continue
    }
    const text = part.text.trim()
    if (!text) continue
    const previous = compact.at(-1)
    if (previous?.kind === 'text') previous.text = `${previous.text}\n\n${text}`
    else compact.push({ kind: 'text', text })
  }
  return compact
}

export function isChatNearBottom(
  metrics: Pick<HTMLElement, 'scrollTop' | 'clientHeight' | 'scrollHeight'>,
  threshold = 72
): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= threshold
}

export function clampConversationPaneWidth(width: number): number {
  return Math.round(
    Math.min(
      CHAT_PANE_LIMITS.conversations.max,
      Math.max(CHAT_PANE_LIMITS.conversations.min, width)
    )
  )
}
