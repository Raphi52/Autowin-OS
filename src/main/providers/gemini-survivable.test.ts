import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const capture = vi.hoisted(() => ({
  direct: [] as string[],
  survivable: [] as Array<{ bin: string; args: string[]; cwd?: string; runId?: string }>,
  hangTail: false,
  releaseCalls: 0,
  tailLine: undefined as ((line: string) => void) | undefined,
  releaseTail: undefined as (() => void) | undefined,
  tailSignal: undefined as AbortSignal | undefined
}))

function fakeChild(): EventEmitter & Record<string, unknown> {
  const child = new EventEmitter() as EventEmitter & Record<string, unknown>
  child.pid = 4343
  child.exitCode = null
  child.stdout = new EventEmitter()
  child.stderr = new EventEmitter()
  child.kill = () => true
  child.unref = () => undefined
  return child
}

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (bin: string, args: string[]) => {
    capture.direct.push(bin)
    const child = fakeChild()
    queueMicrotask(() => {
      const output = args.join(' ').includes('AUTOWIN_AUTH_OK') ? 'AUTOWIN_AUTH_OK' : 'direct'
      const stdout = child.stdout as EventEmitter
      stdout.emit('data', Buffer.from(output))
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
      journalPath: 'C:\\journals\\gemini.txt',
      survivable: true,
      release: () => {
        capture.releaseCalls += 1
      },
      tail: async (onLine: (line: string) => void, options?: { signal?: AbortSignal }) => {
        capture.tailLine = onLine
        capture.tailSignal = options?.signal
        if (capture.hangTail) {
          return await new Promise<{ offset: number; stopped: boolean }>((resolve) => {
            capture.releaseTail = () => resolve({ offset: 0, stopped: true })
          })
        }
        const output = input.args.join(' ').includes('AUTOWIN_AUTH_OK')
          ? 'AUTOWIN_AUTH_OK'
          : 'relay'
        onLine(output)
        queueMicrotask(() => {
          child.exitCode = 0
          child.emit('close', 0)
        })
        return { offset: output.length, stopped: false }
      }
    }
  }
}))

import { GeminiCliAdapter } from './gemini'
import { ProviderRegistry } from './registry'
import { ExecutionSupervisor } from '../execution-supervisor'
import { compileExecutionQuote } from '../execution-quote'

async function drain(stream: ReturnType<GeminiCliAdapter['send']>): Promise<string> {
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
  capture.hangTail = false
  capture.releaseCalls = 0
  capture.tailLine = undefined
  capture.releaseTail = undefined
  capture.tailSignal = undefined
})

describe('GeminiCliAdapter — exécutions sans console', () => {
  it('route la sonde auth et send par le relais survivable commun', async () => {
    const adapter = new GeminiCliAdapter({ command: { executable: 'agy', prefix: [] } })

    await expect(adapter.auth()).resolves.toBe(true)
    await expect(drain(adapter.send([{ role: 'user', content: 'travaille' }]))).resolves.toBe(
      'relay\n'
    )

    expect(capture.direct).toEqual([])
    expect(capture.survivable).toHaveLength(2)
  })

  it('termine sur abort meme si le relais ignore le kill', async () => {
    capture.hangTail = true
    const adapter = new GeminiCliAdapter({ command: { executable: 'agy', prefix: [] } })
    const supervisor = new ExecutionSupervisor()
    const registry = new ProviderRegistry(undefined, supervisor).register(adapter)
    const controller = new AbortController()
    const onChunk = vi.fn()
    const pending = supervisor.run(
      compileExecutionQuote('corrige la typo'),
      controller.signal,
      () => registry.send('gemini', [{ role: 'user', content: 'travaille' }], {}, onChunk)
    )
    await vi.waitFor(() => expect(capture.tailLine).toBeTypeOf('function'))
    controller.abort('stop test')
    capture.tailLine?.('sortie tardive')

    const observed = await Promise.race([
      pending.then(
        () => new Error('appel resolu au lieu de rejeter'),
        (error: unknown) => (error instanceof Error ? error : new Error(String(error)))
      ),
      new Promise<Error>((resolve) =>
        setTimeout(() => resolve(new Error('Gemini ne termine pas apres abort')), 100)
      )
    ])
    capture.releaseTail?.()
    await pending.catch(() => undefined)

    expect(observed).toMatchObject({ name: 'AbortError' })
    expect(onChunk).not.toHaveBeenCalled()
    expect(capture.releaseCalls).toBeGreaterThan(0)
    expect(capture.tailSignal?.aborted).toBe(true)
    expect(supervisor.lastSnapshot()).toMatchObject({
      startedCalls: 1,
      completedCalls: 0,
      failedCalls: 1,
      activeCalls: 0
    })
  })
})
