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
  /** F6 — décomposition du `system` en blocs nommés (skill/discipline/style/capacités/contexte). */
  systemBlocks?: { name: string; chars: number }[]
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

const WINDOWS_1252_BYTES = new Map<string, number>([
  ['\u20ac', 0x80],
  ['\u201a', 0x82],
  ['\u0192', 0x83],
  ['\u201e', 0x84],
  ['\u2026', 0x85],
  ['\u2020', 0x86],
  ['\u2021', 0x87],
  ['\u02c6', 0x88],
  ['\u2030', 0x89],
  ['\u0160', 0x8a],
  ['\u2039', 0x8b],
  ['\u0152', 0x8c],
  ['\u017d', 0x8e],
  ['\u2018', 0x91],
  ['\u2019', 0x92],
  ['\u201c', 0x93],
  ['\u201d', 0x94],
  ['\u2022', 0x95],
  ['\u2013', 0x96],
  ['\u2014', 0x97],
  ['\u02dc', 0x98],
  ['\u2122', 0x99],
  ['\u0161', 0x9a],
  ['\u203a', 0x9b],
  ['\u0153', 0x9c],
  ['\u017e', 0x9e],
  ['\u0178', 0x9f]
])

function mojibakeScore(value: string): number {
  return (value.match(/(?:Ã.|Â.|â..|ð...)/g) ?? []).length
}

function restoreMisdecodedUtf8(value: string): string {
  const initialScore = mojibakeScore(value)
  if (initialScore === 0) return value

  const bytes: number[] = []
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    const byte = codePoint <= 0xff ? codePoint : WINDOWS_1252_BYTES.get(character)
    if (byte === undefined) return value
    bytes.push(byte)
  }

  try {
    const restored = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(bytes))
    return mojibakeScore(restored) < initialScore ? restored : value
  } catch {
    return value
  }
}

function restoreObservedValue<T>(value: T): T {
  if (typeof value === 'string') return restoreMisdecodedUtf8(value) as T
  if (Array.isArray(value)) return value.map(restoreObservedValue) as T
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, restoreObservedValue(entry)])
    ) as T
  }
  return value
}

export function appendPromptCall(
  call: Omit<PromptCallRecord, 'id' | 'ts'>,
  root = promptObservabilityRoot(),
  now: () => number = Date.now,
  makeId: () => string = randomUUID
): PromptCallRecord {
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  const record: PromptCallRecord = {
    ...restoreObservedValue(call),
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
