export type ChatTurnStatus = 'streaming' | 'completed' | 'failed' | 'cancelled' | 'interrupted'

export interface PersistedChatTextPart {
  kind: 'text'
  text: string
  streamId?: string
}

export interface PersistedChatActionPart {
  kind: 'action'
  actionId?: string
  name: string
  args?: unknown
  ok?: boolean
  data?: unknown
}

export type PersistedChatPart = PersistedChatTextPart | PersistedChatActionPart

export interface ChatTurnRuntime {
  provider: string
  model?: string
  reasoningEffort?: string
  sessionId?: string
}

export interface ChatTurnState {
  turnId: string
  status: ChatTurnStatus
  parts: PersistedChatPart[]
  runtime?: ChatTurnRuntime
  error?: string
}

export type ChatTurnEvent =
  | { kind: 'delta'; streamId: string; text: string }
  | { kind: 'stream-reset'; streamId: string }
  | { kind: 'command'; actionId: string; name: string; args?: unknown }
  | { kind: 'result'; actionId: string; name: string; ok?: boolean; data?: unknown }
  | { kind: 'done'; sessionId?: string }
  | { kind: 'failed'; error: string }
  | { kind: 'cancelled' }
  | { kind: 'interrupted' }

const SENSITIVE_KEY = /(?:password|passwd|secret|token|api[-_]?key|authorization|cookie)/i
const MAX_DEPTH = 6
const MAX_KEYS = 80
const MAX_ARRAY = 80
const MAX_STRING = 12_000

export function sanitizePersistedValue(value: unknown): unknown {
  const seen = new WeakSet<object>()

  const visit = (current: unknown, depth: number, key?: string): unknown => {
    if (key && SENSITIVE_KEY.test(key)) return '[masqué]'
    if (typeof current === 'string')
      return current.length > MAX_STRING ? `${current.slice(0, MAX_STRING)}…` : current
    if (
      current === null ||
      typeof current === 'number' ||
      typeof current === 'boolean' ||
      current === undefined
    )
      return current
    if (typeof current !== 'object') return String(current)
    if (depth >= MAX_DEPTH) return '[profondeur limitée]'
    if (seen.has(current)) return '[référence circulaire]'
    seen.add(current)
    if (Array.isArray(current))
      return current.slice(0, MAX_ARRAY).map((item) => visit(item, depth + 1))

    const output: Record<string, unknown> = {}
    for (const [entryKey, entryValue] of Object.entries(current).slice(0, MAX_KEYS))
      output[entryKey] = visit(entryValue, depth + 1, entryKey)
    return output
  }

  return visit(value, 0)
}

export function createChatTurn(turnId: string, runtime?: ChatTurnRuntime): ChatTurnState {
  return { turnId, status: 'streaming', parts: [], ...(runtime ? { runtime } : {}) }
}

export function reduceChatTurn(state: ChatTurnState, event: ChatTurnEvent): ChatTurnState {
  if (event.kind === 'delta') {
    if (!event.text) return state
    const parts = state.parts.slice()
    const previous = parts.at(-1)
    if (previous?.kind === 'text' && previous.streamId === event.streamId)
      parts[parts.length - 1] = { ...previous, text: previous.text + event.text }
    else parts.push({ kind: 'text', streamId: event.streamId, text: event.text })
    return { ...state, status: 'streaming', parts }
  }

  if (event.kind === 'stream-reset')
    return {
      ...state,
      parts: state.parts.filter(
        (part) => !(part.kind === 'text' && part.streamId === event.streamId)
      )
    }

  if (event.kind === 'command')
    return {
      ...state,
      parts: [
        ...state.parts,
        {
          kind: 'action',
          actionId: event.actionId,
          name: event.name,
          ...(event.args === undefined ? {} : { args: sanitizePersistedValue(event.args) })
        }
      ]
    }

  if (event.kind === 'result') {
    const parts = state.parts.slice()
    for (let index = parts.length - 1; index >= 0; index -= 1) {
      const part = parts[index]
      if (part.kind !== 'action' || part.actionId !== event.actionId) continue
      parts[index] = {
        ...part,
        ok: event.ok,
        ...(event.data === undefined ? {} : { data: sanitizePersistedValue(event.data) })
      }
      break
    }
    return { ...state, parts }
  }

  if (event.kind === 'done')
    return {
      ...state,
      status: 'completed',
      ...(event.sessionId
        ? {
            runtime: {
              provider: state.runtime?.provider ?? 'unknown',
              ...state.runtime,
              sessionId: event.sessionId
            }
          }
        : {})
    }
  if (event.kind === 'failed') return { ...state, status: 'failed', error: event.error }
  if (event.kind === 'cancelled') return { ...state, status: 'cancelled' }
  return { ...state, status: 'interrupted' }
}

export function flattenChatParts(parts: PersistedChatPart[]): string {
  return parts
    .map((part) =>
      part.kind === 'text'
        ? part.text
        : `[a exécuté ${part.name}${part.ok === false ? ' (échec)' : ''}]`
    )
    .filter(Boolean)
    .join('\n')
}
