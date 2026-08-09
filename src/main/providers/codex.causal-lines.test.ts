import { execFileSync } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { exactLineFingerprint } from '../exact-line-fingerprint'

vi.mock('../runs/survivable-spawn', () => ({
  spawnSurvivable: (input: { cwd: string }) => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.pid = 5152
    child.exitCode = null
    child.kill = () => true
    return {
      child,
      pid: child.pid,
      spawnToken: 'codex-causal-lines',
      journalPath: 'C:\\journals\\codex-causal-lines.jsonl',
      survivable: true,
      release: vi.fn(),
      tail: async (onLine: (line: string) => void) => {
        const path = join(input.cwd, 'app.log')
        writeFileSync(path, 'ERROR auto\nERROR auto\n', 'utf8')
        onLine(
          JSON.stringify({
            type: 'item.completed',
            item: {
              type: 'file_change',
              status: 'completed',
              changes: { [path]: { kind: 'update' } }
            }
          })
        )
        onLine(
          JSON.stringify({
            type: 'item.completed',
            item: { type: 'agent_message', text: 'termine' }
          })
        )
        queueMicrotask(() => {
          child.exitCode = 0
          child.emit('close', 0)
        })
        return { offset: 2, stopped: false }
      }
    }
  }
}))

import { CodexAdapter } from './codex'

const roots: string[] = []
const previousBin = process.env.CODEX_BIN

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (previousBin === undefined) delete process.env.CODEX_BIN
  else process.env.CODEX_BIN = previousBin
})

describe('Codex CLI - causalite des mutations objet', () => {
  it('complete un file_change sans diff par le delta exact du worktree isole', async () => {
    const root = mkdtempSync(join(tmpdir(), 'autowin-codex-causal-lines-'))
    roots.push(root)
    execFileSync('git', ['init'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@autowin.local'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'Autowin Test'], { cwd: root })
    writeFileSync(join(root, 'app.log'), 'INFO initial\n', 'utf8')
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-m', 'initial'], { cwd: root })
    process.env.CODEX_BIN = 'codex-test'

    const stream = new CodexAdapter().send([{ role: 'user', content: 'modifie le log' }], {
      execution: { cwd: root, sandbox: 'workspace-write', causallyIsolated: true }
    })
    let step = await stream.next()
    while (!step.done) step = await stream.next()

    const delta = step.value.executionEvidence?.find(({ type }) => type === 'workspace_delta')
    expect(delta).toMatchObject({
      paths: ['app.log'],
      writtenLineFingerprintsByPath: {
        'app.log': [exactLineFingerprint('ERROR auto'), exactLineFingerprint('ERROR auto')]
      }
    })
  })
})
