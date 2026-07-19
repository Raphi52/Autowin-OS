import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeSync
} from 'node:fs'
import { join } from 'node:path'
import { assertTraceEvent, type TraceEventV1 } from './trace-event'

export class TraceStore {
  private readonly ids = new Map<string, Set<string>>()
  private readonly descriptors = new Map<string, number>()
  private readonly lastSequences = new Map<string, number>()

  constructor(private readonly root: string) {}

  private path(conversationId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error('conversationId invalide')
    return join(this.root, `${conversationId}.jsonl`)
  }

  append(event: TraceEventV1): this {
    assertTraceEvent(event)
    const existing = this.ids.has(event.conversationId)
      ? undefined
      : this.readConversation(event.conversationId)
    const seen = this.ids.get(event.conversationId) ?? new Set(existing!.map((x) => x.id))
    if (seen.has(event.id)) throw new Error(`événement dupliqué: ${event.id}`)
    const lastSequence =
      this.lastSequences.get(event.conversationId) ??
      (existing?.length ? existing[existing.length - 1].sequence : -1)
    if (event.sequence <= lastSequence)
      throw new Error(`sequence non monotone: ${event.sequence} <= ${lastSequence}`)
    if (event.parentId && !seen.has(event.parentId))
      throw new Error(`parent causal introuvable: ${event.parentId}`)
    mkdirSync(this.root, { recursive: true })
    const descriptor =
      this.descriptors.get(event.conversationId) ?? openSync(this.path(event.conversationId), 'a')
    this.descriptors.set(event.conversationId, descriptor)
    writeSync(descriptor, `${JSON.stringify(event)}\n`, undefined, 'utf8')
    seen.add(event.id)
    this.ids.set(event.conversationId, seen)
    this.lastSequences.set(event.conversationId, event.sequence)
    return this
  }

  readConversation(conversationId: string): TraceEventV1[] {
    const path = this.path(conversationId)
    if (!existsSync(path)) return []
    const out: TraceEventV1[] = []
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    const lastContentIndex = lines.reduce((last, line, index) => (line ? index : last), -1)
    for (const [index, line] of lines.entries()) {
      if (!line) continue
      try {
        const event = assertTraceEvent(JSON.parse(line) as TraceEventV1)
        if (event.conversationId === conversationId) out.push(event)
      } catch (error) {
        if (index === lastContentIndex && error instanceof SyntaxError) continue
        throw new Error(`trace corrompue ligne ${index + 1}`, { cause: error })
      }
    }
    return out.sort((a, b) => a.sequence - b.sequence)
  }

  nextSequence(conversationId: string): number {
    const events = this.readConversation(conversationId)
    return events.length ? Math.max(...events.map((event) => event.sequence)) + 1 : 0
  }

  exportConversation(conversationId: string): TraceEventV1[] {
    return this.readConversation(conversationId)
  }
  importConversation(events: TraceEventV1[]): this {
    for (const event of events) this.append(event)
    return this
  }
  deleteConversation(conversationId: string): boolean {
    const path = this.path(conversationId)
    if (!existsSync(path)) return false
    const descriptor = this.descriptors.get(conversationId)
    if (descriptor !== undefined) {
      closeSync(descriptor)
      this.descriptors.delete(conversationId)
    }
    rmSync(path)
    this.ids.delete(conversationId)
    this.lastSequences.delete(conversationId)
    return true
  }
  appendRawForRecoveryTest(line: string): void {
    mkdirSync(this.root, { recursive: true })
    appendFileSync(this.path('conv-1'), line, 'utf8')
  }
}
