import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { afterAll, describe, expect, it } from 'vitest'
import { ConversationEventStore } from './store/conversation-event-store'

const root = mkdtempSync(join(tmpdir(), 'autowin-conversation-benchmark-'))
afterAll(() => rmSync(root, { recursive: true, force: true }))

describe('conversation foundation benchmark', () => {
  it(
    'queries 10k events across 100 branches within the Wave 0 budget',
    () => {
      const lines: string[] = []
      let parentEventId: string | undefined
      for (let index = 0; index < 10_000; index += 1) {
        const eventId = `event-${index}`
        lines.push(JSON.stringify({
          eventId,
          ...(parentEventId ? { parentEventId } : {}),
          conversationId: 'conv-benchmark',
          branchId: `branch-${index % 100}`,
          turnId: `turn-${Math.floor(index / 2)}`,
          kind: index % 2 === 0 ? 'turn.started' : 'turn.completed',
          ts: index
        }))
        parentEventId = eventId
      }
      mkdirSync(root, { recursive: true })
      writeFileSync(join(root, 'conv-benchmark.jsonl'), `${lines.join('\n')}\n`, 'utf8')
      const store = new ConversationEventStore(root)

      const started = performance.now()
      const events = store.list('conv-benchmark')
      const queryMs = performance.now() - started

      expect(events).toHaveLength(10_000)
      expect(new Set(events.map((event) => event.branchId))).toHaveLength(100)
      expect(queryMs).toBeLessThanOrEqual(250)
    },
    15_000
  )
})
