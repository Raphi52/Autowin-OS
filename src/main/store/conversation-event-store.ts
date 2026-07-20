import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface ConversationEvent {
  eventId: string
  parentEventId?: string
  conversationId: string
  branchId: string
  turnId?: string
  actionId?: string
  kind: string
  ts: number
  payload?: Record<string, unknown>
}

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,127}$/

export class ConversationEventStore {
  private readonly cache = new Map<string, ConversationEvent[]>()

  constructor(private readonly root: string) {}

  private pathFor(conversationId: string): string {
    if (!SAFE_ID.test(conversationId)) throw new Error(`invalid conversationId: ${conversationId}`)
    return join(this.root, `${conversationId}.jsonl`)
  }

  private eventsFor(conversationId: string): ConversationEvent[] {
    const cached = this.cache.get(conversationId)
    if (cached) return cached
    const path = this.pathFor(conversationId)
    if (!existsSync(path)) {
      const empty: ConversationEvent[] = []
      this.cache.set(conversationId, empty)
      return empty
    }
    const content = readFileSync(path, 'utf8').trim()
    const events = content
      ? content.split(/\r?\n/).map((line, index) => {
      try {
        return JSON.parse(line) as ConversationEvent
      } catch (error) {
        throw new Error(`corrupt conversation event at line ${index + 1}`, { cause: error })
      }
        })
      : []
    this.cache.set(conversationId, events)
    return events
  }

  list(conversationId: string): ConversationEvent[] {
    return [...this.eventsFor(conversationId)]
  }

  append(event: ConversationEvent): void {
    if (!SAFE_ID.test(event.eventId)) throw new Error(`invalid eventId: ${event.eventId}`)
    if (!SAFE_ID.test(event.branchId)) throw new Error(`invalid branchId: ${event.branchId}`)
    const path = this.pathFor(event.conversationId)
    const existing = this.eventsFor(event.conversationId)
    if (existing.some((candidate) => candidate.eventId === event.eventId)) {
      throw new Error(`duplicate eventId: ${event.eventId}`)
    }
    if (
      event.parentEventId &&
      !existing.some((candidate) => candidate.eventId === event.parentEventId)
    ) {
      throw new Error(`missing parentEventId: ${event.parentEventId}`)
    }
    mkdirSync(this.root, { recursive: true })
    appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8')
    existing.push(event)
  }
}
