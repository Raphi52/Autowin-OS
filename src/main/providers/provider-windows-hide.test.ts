import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const spawnCapture = vi.hoisted(() => ({
  calls: [] as Array<{
    bin: string
    args: string[]
    options: Record<string, unknown>
  }>
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (bin: string, args: string[], options: Record<string, unknown> = {}) => {
    spawnCapture.calls.push({ bin, args, options })
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null

    queueMicrotask(() => {
      if (args.includes('--version')) {
        child.emit('close', 0)
        return
      }
      if (bin === 'powershell.exe' || bin === 'cmd.exe') return
      const event = bin === 'claude-test' ? { type: 'result', result: 'ok' } : { delta: 'ok' }
      stdout.emit('data', Buffer.from(`${JSON.stringify(event)}\n`))
      child.emit('close', 0)
    })

    return child
  }
}))

import { ClaudeCliAdapter } from './claude'
import { KimiCliAdapter } from './kimi'

async function drain(stream: AsyncGenerator<unknown, unknown, void>): Promise<void> {
  let step = await stream.next()
  while (!step.done) step = await stream.next()
}

beforeEach(() => {
  spawnCapture.calls = []
})

describe('providers CLI — consoles Windows non interactives', () => {
  it('masque les contrôles et exécutions Claude', async () => {
    const adapter = new ClaudeCliAdapter({ bin: 'claude-test' })

    await adapter.auth()
    await drain(adapter.send([{ role: 'user', content: 'test' }]))

    expect(spawnCapture.calls).toHaveLength(2)
    expect(spawnCapture.calls.every((call) => call.options.windowsHide === true)).toBe(true)
  })

  it('masque les contrôles et exécutions Kimi', async () => {
    const adapter = new KimiCliAdapter({ bin: 'kimi-test' })

    await adapter.auth()
    await drain(adapter.send([{ role: 'user', content: 'test' }]))

    expect(spawnCapture.calls).toHaveLength(2)
    expect(spawnCapture.calls.every((call) => call.options.windowsHide === true)).toBe(true)
  })
})
