import {
  reduceChatTurn,
  type ChatTurnEvent,
  type ChatTurnStatus,
  type PersistedChatActionPart,
  type PersistedChatPart,
  type PersistedChatTextPart
} from '../../../shared/chat-turn'

export type ChatActionPart = PersistedChatActionPart
export type ChatTextPart = PersistedChatTextPart
export type ChatPart = PersistedChatPart
export type ChatActivityBlock = { kind: 'activity'; actions: ChatActionPart[] }
export type ChatRenderBlock = ChatTextPart | ChatActivityBlock

export interface HydratedAssistantMessage {
  role: 'assistant'
  turnId?: string
  parts: ChatPart[]
  status: ChatTurnStatus
  done: boolean
  error?: string
}

export interface StoredAssistantMessage {
  content: string
  turnId?: string
  parts?: ChatPart[]
  status?: ChatTurnStatus
  error?: string
}

export interface AssistantPilotEvent {
  turnId?: string
  kind:
    | 'delta'
    | 'stream-reset'
    | 'think'
    | 'command'
    | 'result'
    | 'done'
    | 'error'
    | 'retry'
    | 'cancellation'
  streamId?: string
  actionId?: string
  iteration?: number
  text?: string
  name?: string
  args?: unknown
  ok?: boolean
  data?: unknown
}

export function hydrateStoredAssistant(message: StoredAssistantMessage): HydratedAssistantMessage {
  const status = message.status ?? 'completed'
  return {
    role: 'assistant',
    ...(message.turnId ? { turnId: message.turnId } : {}),
    parts:
      message.parts?.map((part) => ({ ...part })) ??
      (message.content ? [{ kind: 'text', text: message.content }] : []),
    status,
    done: status !== 'streaming',
    ...(message.error ? { error: message.error } : {})
  }
}

export function reduceAssistantPilotEvent(
  message: HydratedAssistantMessage,
  event: AssistantPilotEvent
): HydratedAssistantMessage {
  if (message.done && !message.turnId) return message
  if (message.turnId && event.turnId && message.turnId !== event.turnId) return message
  const turnId = message.turnId ?? event.turnId ?? 'pending'
  let turnEvent: ChatTurnEvent | undefined
  if (event.kind === 'delta' && event.text && event.streamId)
    turnEvent = { kind: 'delta', streamId: event.streamId, text: event.text }
  else if (event.kind === 'stream-reset' && event.streamId)
    turnEvent = { kind: 'stream-reset', streamId: event.streamId }
  else if (event.kind === 'think' && event.text)
    turnEvent = {
      kind: 'delta',
      streamId: `fallback:${event.iteration ?? 0}`,
      text: event.text
    }
  else if (event.kind === 'command' && event.name)
    turnEvent = {
      kind: 'command',
      actionId: event.actionId ?? `action:${message.parts.length}`,
      name: event.name,
      args: event.args
    }
  else if (event.kind === 'result' && event.name) {
    const matching = [...message.parts]
      .reverse()
      .find(
        (part) =>
          part.kind === 'action' &&
          part.name === event.name &&
          (event.actionId ? part.actionId === event.actionId : part.ok === undefined)
      )
    turnEvent = {
      kind: 'result',
      actionId:
        event.actionId ??
        (matching?.kind === 'action' ? matching.actionId : undefined) ??
        `action:${message.parts.length}`,
      name: event.name,
      ok: event.ok,
      data: event.data
    }
  } else if (event.kind === 'done') turnEvent = { kind: 'done' }
  else if (event.kind === 'error')
    turnEvent = { kind: 'failed', error: event.text ?? 'Erreur inconnue' }
  else if (event.kind === 'cancellation') turnEvent = { kind: 'cancelled' }
  if (!turnEvent) return message

  const next = reduceChatTurn(
    {
      turnId,
      status: message.status,
      parts: message.parts,
      ...(message.error ? { error: message.error } : {})
    },
    turnEvent
  )
  return {
    role: 'assistant',
    turnId,
    parts: next.parts,
    status: next.status,
    done: next.status !== 'streaming',
    ...(next.error ? { error: next.error } : {})
  }
}

interface RuntimeSlot {
  slotId?: string
  provider: string
  modelId: string
  reasoningEffort: string
}

interface RuntimeTopology {
  orchestrator: RuntimeSlot
}

export interface RuntimeModel {
  id: string
  provider: string
  model: string
  label?: string
}

export interface OrchestratorModelOption {
  provider: string
  model: string
  label: string
}

export interface OrchestratorModelGroup {
  provider: string
  options: OrchestratorModelOption[]
}

export function buildOrchestratorModelGroups(
  models: RuntimeModel[],
  current?: { provider: string; model?: string }
): {
  groups: OrchestratorModelGroup[]
  currentMissing?: OrchestratorModelOption
} {
  const byProvider = new Map<string, OrchestratorModelOption[]>()
  for (const item of models) {
    const option = {
      provider: item.provider,
      model: item.model,
      label: item.label?.trim() || item.model
    }
    const options = byProvider.get(item.provider) ?? []
    if (!options.some((entry) => entry.model === option.model)) options.push(option)
    byProvider.set(item.provider, options)
  }
  const groups = [...byProvider.entries()].map(([provider, options]) => ({ provider, options }))
  const currentModel = current?.model
  const currentExists =
    currentModel !== undefined &&
    models.some(
      (item) =>
        item.provider === current?.provider &&
        (item.model === currentModel || item.id === currentModel)
    )
  return {
    groups,
    ...(!currentExists && current && currentModel
      ? {
          currentMissing: {
            provider: current.provider,
            model: currentModel,
            label: `${current.provider} · ${currentModel} (indisponible)`
          }
        }
      : {})
  }
}

interface RuntimeRoleBinding {
  provider: string
  model?: string
  reasoningEffort?: string
}

export interface ChatRuntimeIdentity {
  provider: string
  model: string
  modelLabel: string
  reasoningEffort: string
}

export interface ScopedLiveRun<TStep = unknown> {
  convId: string
  runPath?: string
  task: string
  steps: TStep[]
  status: 'running' | 'green' | 'red'
}

export type ScopedLiveRunEvent<TStep = unknown> =
  | { type: 'start'; convId: string; runPath?: string; task: string }
  | { type: 'step'; convId: string; runPath?: string; step: TStep }
  | { type: 'end'; convId: string; runPath?: string; status: 'green' | 'red' }
  | { type: 'clear'; convId: string; runPath?: string }

export interface RunRequestIdentity {
  id: number
  scope: 'conv' | 'tous'
  convId: string | null
}

export const CHAT_PANE_LIMITS = {
  conversations: { min: 224, max: 480 },
  workflows: { min: 280, max: 760 }
} as const

export function resolveChatRuntimeIdentity(
  topology: RuntimeTopology,
  models: RuntimeModel[],
  role?: RuntimeRoleBinding
): ChatRuntimeIdentity {
  const slot = topology.orchestrator
  if (role) {
    const imported = role.model
      ? models.find(
          (model) =>
            model.provider === role.provider &&
            (model.id === role.model || model.model === role.model)
        )
      : undefined
    return {
      provider: role.provider,
      model: imported?.model ?? role.model ?? 'default',
      modelLabel: imported?.label?.trim() || role.model || `${role.provider} · modèle par défaut`,
      reasoningEffort: role.reasoningEffort ?? 'auto'
    }
  }
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

export function groupAssistantActivity(parts: ChatPart[]): ChatRenderBlock[] {
  const blocks: ChatRenderBlock[] = []
  for (const part of coalesceAssistantParts(parts)) {
    if (part.kind === 'text') {
      blocks.push(part)
      continue
    }
    const previous = blocks.at(-1)
    if (previous?.kind === 'activity') previous.actions.push(part)
    else blocks.push({ kind: 'activity', actions: [part] })
  }
  return blocks
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

export function reduceScopedLiveRuns<TStep>(
  current: Record<string, ScopedLiveRun<TStep>>,
  event: ScopedLiveRunEvent<TStep>
): Record<string, ScopedLiveRun<TStep>> {
  if (event.type === 'start') {
    return {
      ...current,
      [event.convId]: {
        convId: event.convId,
        runPath: event.runPath,
        task: event.task,
        steps: [],
        status: 'running'
      }
    }
  }

  const existing = current[event.convId]
  if (!existing || (event.runPath && existing.runPath && event.runPath !== existing.runPath)) {
    return current
  }
  if (event.type === 'step') {
    return { ...current, [event.convId]: { ...existing, steps: [...existing.steps, event.step] } }
  }
  if (event.type === 'end') {
    return { ...current, [event.convId]: { ...existing, status: event.status } }
  }
  const next = { ...current }
  delete next[event.convId]
  return next
}

export function isRunRequestCurrent(
  requested: RunRequestIdentity,
  current: RunRequestIdentity
): boolean {
  return (
    requested.id === current.id &&
    requested.scope === current.scope &&
    requested.convId === current.convId
  )
}
