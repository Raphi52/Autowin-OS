import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../runs/survivable-spawn', () => ({
  spawnSurvivable: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.pid = 5151
    child.exitCode = null
    child.kill = () => true
    queueMicrotask(() => {
      child.exitCode = 0
      child.emit('close', 0)
    })
    return {
      child,
      pid: child.pid,
      spawnToken: 'codex-tail',
      journalPath: 'C:\\journals\\codex-tail.jsonl',
      survivable: true,
      release: vi.fn(),
      tail: async (onLine: (line: string) => void) => {
        await new Promise((resolve) => setTimeout(resolve, 25))
        onLine(
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'agent_message', text: 'dernière ligne Codex' }
          })
        )
        return { offset: 1, stopped: false }
      }
    }
  }
}))

import { CodexAdapter } from './codex'

const previousBin = process.env.CODEX_BIN
afterEach(() => {
  if (previousBin === undefined) delete process.env.CODEX_BIN
  else process.env.CODEX_BIN = previousBin
})

describe('Codex CLI — barrière de drain du journal', () => {
  it('attend la dernière ligne du tail même si close arrive avant elle', async () => {
    process.env.CODEX_BIN = 'codex-test'
    const stream = new CodexAdapter().send([{ role: 'user', content: 'travaille' }], {
      execution: { cwd: process.cwd(), sandbox: 'workspace-write' }
    })

    let step = await stream.next()
    while (!step.done) step = await stream.next()

    expect(step.value.text).toBe('dernière ligne Codex')
  })
})
