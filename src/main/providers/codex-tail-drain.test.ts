import { EventEmitter } from 'node:events'
import { afterEach, describe, expect, it, vi } from 'vitest'

const relay = vi.hoisted(() => ({ tailDelayMs: 25 }))

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
        await new Promise((resolve) => setTimeout(resolve, relay.tailDelayMs))
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
  relay.tailDelayMs = 25
  if (previousBin === undefined) delete process.env.CODEX_BIN
  else process.env.CODEX_BIN = previousBin
})

describe('Codex CLI — barrière de drain du journal', () => {
  it('ne coupe plus un appel sur sa DURÉE : le drain va jusqu’à la dernière ligne', async () => {
    // Même cause que côté Claude (conv-729, turn aa90027e-01c1-4d39-9645-7e5d01619323) : le cap de
    // durée totale tuait des tours vivants. Supprimé.
    process.env.CODEX_BIN = 'codex-test'
    relay.tailDelayMs = 60
    const stream = new CodexAdapter().send([{ role: 'user', content: 'travaille longtemps' }], {
      execution: { cwd: process.cwd(), sandbox: 'read-only', providerTimeoutMs: 1 }
    })

    let step = await stream.next()
    while (!step.done) step = await stream.next()
    expect(step.value.text).toBe('dernière ligne Codex')
  })

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
