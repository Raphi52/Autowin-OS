import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const relay = vi.hoisted(() => ({ emitClose: true, certifiedExit: undefined as number | undefined }))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.pid = 5252
    child.exitCode = null
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end: () => undefined }
    child.kill = () => true
    child.unref = () => undefined
    if (relay.emitClose) {
      queueMicrotask(() => {
        child.exitCode = 0
        child.emit('close', 0)
      })
    }
    return child
  }
}))

vi.mock('../runs/stdout-journal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs/stdout-journal')>()),
  survivableExitCode: () => relay.certifiedExit,
  tailJsonLines: async (
    _path: string,
    onLine: (line: string) => void,
    options?: { isComplete?: () => boolean }
  ) => {
    await new Promise((resolve) => setTimeout(resolve, 25))
    onLine(
      JSON.stringify({
        type: 'result',
        subtype: 'success',
        result: 'dernière ligne Claude',
        session_id: 'tail-session',
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
      })
    )
    while (!options?.isComplete?.()) await new Promise((resolve) => setTimeout(resolve, 5))
    return { offset: 1, stopped: false }
  }
}))

import { ClaudeCliAdapter } from './claude'

const roots: string[] = []
const previousRoot = process.env.AUTOWIN_RUN_JOURNAL_ROOT

afterEach(() => {
  relay.emitClose = true
  relay.certifiedExit = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (previousRoot === undefined) delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
  else process.env.AUTOWIN_RUN_JOURNAL_ROOT = previousRoot
})

describe('Claude CLI — barrière de drain du journal', () => {
  it('attend la dernière ligne du tail même si close arrive avant elle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-claude-tail-'))
    roots.push(root)
    process.env.AUTOWIN_RUN_JOURNAL_ROOT = root
    const lifecycle: string[] = []
    const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
      [{ role: 'user', content: 'travaille' }],
      {
        execution: {
          cwd: root,
          sandbox: 'read-only',
          onSpawnIntent: () => {
            lifecycle.push('intent')
          },
          onSpawned: () => {
            lifecycle.push('spawned')
          },
          onJournal: () => {
            lifecycle.push('journal')
          }
        }
      }
    )

    let step = await stream.next()
    while (!step.done) step = await stream.next()

    expect(step.value.text).toBe('dernière ligne Claude')
    expect(lifecycle.slice(0, 3)).toEqual(['intent', 'journal', 'spawned'])
  })

  it('termine sur la preuve durable du relais quand close est perdu', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-claude-relay-exit-'))
    roots.push(root)
    process.env.AUTOWIN_RUN_JOURNAL_ROOT = root
    relay.emitClose = false
    relay.certifiedExit = 0
    const controller = new AbortController()
    const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
      [{ role: 'user', content: 'travaille' }],
      { signal: controller.signal, execution: { cwd: root, sandbox: 'read-only' } }
    )
    const completed = (async () => {
      let step = await stream.next()
      while (!step.done) step = await stream.next()
      return step.value
    })().then(
      (value) => ({ kind: 'done' as const, value }),
      (error: unknown) => ({ kind: 'error' as const, error })
    )
    const outcome = await Promise.race([
      completed,
      new Promise<{ kind: 'timeout' }>((resolve) =>
        setTimeout(() => {
          controller.abort()
          resolve({ kind: 'timeout' })
        }, 250)
      )
    ])

    expect(outcome.kind).toBe('done')
    if (outcome.kind === 'done') expect(outcome.value.text).toContain('Claude')
  })
})
