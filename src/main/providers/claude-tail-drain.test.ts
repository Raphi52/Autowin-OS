import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

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
    queueMicrotask(() => {
      child.exitCode = 0
      child.emit('close', 0)
    })
    return child
  }
}))

vi.mock('../runs/stdout-journal', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../runs/stdout-journal')>()),
  tailJsonLines: async (_path: string, onLine: (line: string) => void) => {
    await new Promise((resolve) => setTimeout(resolve, 25))
    onLine(
      JSON.stringify({
        type: 'result',
        result: 'dernière ligne Claude',
        session_id: 'tail-session',
        is_error: false
      })
    )
    return { offset: 1, stopped: false }
  }
}))

import { ClaudeCliAdapter } from './claude'

const roots: string[] = []
const previousRoot = process.env.AUTOWIN_RUN_JOURNAL_ROOT

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (previousRoot === undefined) delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
  else process.env.AUTOWIN_RUN_JOURNAL_ROOT = previousRoot
})

describe('Claude CLI — barrière de drain du journal', () => {
  it('attend la dernière ligne du tail même si close arrive avant elle', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-claude-tail-'))
    roots.push(root)
    process.env.AUTOWIN_RUN_JOURNAL_ROOT = root
    const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send([
      { role: 'user', content: 'travaille' }
    ])

    let step = await stream.next()
    while (!step.done) step = await stream.next()

    expect(step.value.text).toBe('dernière ligne Claude')
  })
})
