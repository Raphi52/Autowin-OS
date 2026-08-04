import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const capture = vi.hoisted(() => ({
  direct: [] as string[],
  survivable: [] as Array<{ bin: string; args: string[]; cwd?: string; runId?: string }>,
  journals: [] as Array<{ token: string; path: string }>
}))

function fakeChild(): EventEmitter & {
  pid: number
  exitCode: number | null
  stdout: EventEmitter
  stderr: EventEmitter
  kill: () => boolean
  unref: () => void
} {
  const child = new EventEmitter() as ReturnType<typeof fakeChild>
  child.pid = 4242
  child.exitCode = null
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  child.unref = () => undefined
  return child
}

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (bin: string) => {
    capture.direct.push(bin)
    const child = fakeChild()
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.from(`${JSON.stringify({ delta: 'direct' })}\n`))
      child.exitCode = 0
      child.emit('close', 0)
    })
    return child
  }
}))

vi.mock('../runs/survivable-spawn', () => ({
  spawnSurvivable: (input: { bin: string; args: string[]; cwd?: string; runId?: string }) => {
    capture.survivable.push(input)
    const child = fakeChild()
    return {
      child,
      pid: child.pid,
      spawnToken: input.runId,
      journalPath: 'C:\\journals\\kimi.jsonl',
      survivable: true,
      release: vi.fn(),
      tail: async (onLine: (line: string) => void) => {
        onLine(JSON.stringify({ delta: 'relay' }))
        queueMicrotask(() => {
          child.exitCode = 0
          child.emit('close', 0)
        })
        return { offset: 18, stopped: false }
      }
    }
  }
}))

import { KimiCliAdapter } from './kimi'

async function drain(stream: ReturnType<KimiCliAdapter['send']>): Promise<string> {
  let text = ''
  let step = await stream.next()
  while (!step.done) {
    text += step.value.delta
    step = await stream.next()
  }
  return text
}

beforeEach(() => {
  capture.direct = []
  capture.survivable = []
  capture.journals = []
})

describe('KimiCliAdapter — exécution sans console', () => {
  it('fait passer send par le relais survivable commun et publie son journal', async () => {
    const adapter = new KimiCliAdapter({ bin: 'kimi-test' })

    const text = await drain(
      adapter.send([{ role: 'user', content: 'travaille' }], {
        execution: {
          cwd: process.cwd(),
          sandbox: 'workspace-write',
          onJournal: (token, path) => capture.journals.push({ token, path })
        }
      })
    )

    expect(text).toBe('relay')
    expect(capture.direct).toEqual([])
    expect(capture.survivable).toHaveLength(1)
    expect(capture.survivable[0]).toMatchObject({ bin: 'kimi-test' })
    expect(capture.survivable[0].args).toContain('--output-format')
    expect(capture.journals).toEqual([
      { token: capture.survivable[0].runId!, path: 'C:\\journals\\kimi.jsonl' }
    ])
  })
})
