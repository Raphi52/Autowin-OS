import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import type { Message, Usage } from '../providers/types'

export interface PromptCallRecord {
  id: string
  ts: string
  conversationId: string
  turnId: string
  iteration: number
  actor: string
  provider: string
  model?: string
  transport: string
  boundary: string
  limitation: string
  system?: string
  messages: Message[]
  options: Record<string, unknown>
  response: string
  status?: 'completed' | 'failed'
  error?: string
  usage?: Usage
  durationMs?: number
  sessionId?: string
}

export function promptObservabilityRoot(): string {
  return join(ensureAutowinAppData(), 'prompt-observability')
}

function fileFor(conversationId: string, root: string): string {
  return join(root, `${conversationId.replace(/[^a-zA-Z0-9_-]/g, '_')}.jsonl`)
}

export function appendPromptCall(
  call: Omit<PromptCallRecord, 'id' | 'ts'>,
  root = promptObservabilityRoot(),
  now: () => number = Date.now,
  makeId: () => string = randomUUID
): PromptCallRecord {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  const record: PromptCallRecord = {
    ...call,
    id: makeId(),
    ts: new Date(now()).toISOString()
  }
  appendFileSync(fileFor(call.conversationId, root), `${JSON.stringify(record)}\n`, 'utf8')
  return record
}

export function loadPromptCalls(
  conversationId: string,
  root = promptObservabilityRoot()
): PromptCallRecord[] {
  try {
    const path = fileFor(conversationId, root)
    if (!existsSync(path)) return []
    return readFileSync(path, 'utf8')
      .split(/\r?\n/)
      .filter(Boolean)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as PromptCallRecord]
        } catch {
          return []
        }
      })
  } catch {
    return []
  }
}

export function loadAllPromptCalls(root = promptObservabilityRoot()): PromptCallRecord[] {
  try {
    if (!existsSync(root)) return []
    return readdirSync(root)
      .filter((name) => name.endsWith('.jsonl'))
      .flatMap((name) => {
        const conversationId = name.slice(0, -'.jsonl'.length)
        return loadPromptCalls(conversationId, root)
      })
      .sort((a, b) => b.ts.localeCompare(a.ts))
  } catch {
    return []
  }
}

export function deletePromptCalls(
  conversationId: string,
  root = promptObservabilityRoot()
): boolean {
  const path = fileFor(conversationId, root)
  if (!existsSync(path)) return false
  rmSync(path)
  return true
}

export function promptLoadBreakdown(calls: ReadonlyArray<Omit<PromptCallRecord, 'id' | 'ts'>>): {
  calls: number
  measuredInputTokens: number
  measuredOutputTokens: number
  cacheReadTokens: number
  observedCharacters: number
  sources: Array<{ kind: 'system' | 'messages'; characters: number }>
} {
  const systemCharacters = calls.reduce((sum, call) => sum + (call.system?.length ?? 0), 0)
  const messageCharacters = calls.reduce(
    (sum, call) => sum + call.messages.reduce((part, message) => part + message.content.length, 0),
    0
  )
  return {
    calls: calls.length,
    measuredInputTokens: calls.reduce((sum, call) => sum + (call.usage?.inputTokens ?? 0), 0),
    measuredOutputTokens: calls.reduce((sum, call) => sum + (call.usage?.outputTokens ?? 0), 0),
    cacheReadTokens: calls.reduce((sum, call) => sum + (call.usage?.cacheReadTokens ?? 0), 0),
    observedCharacters: systemCharacters + messageCharacters,
    sources: [
      { kind: 'system', characters: systemCharacters },
      { kind: 'messages', characters: messageCharacters }
    ]
  }
}
