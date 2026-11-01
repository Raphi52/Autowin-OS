import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCliAdapter } from './claude'
import type { SendOptions } from './types'
import { AUTOWIN_WORKSPACE_ENV } from '../../shared/app-identity'

/**
 * UN APPEL SANS `execution` N'EST PAS UN APPEL SANS OUTIL (conv-1420, 2026-11-01).
 *
 * Il prend la branche du tour de chat : Bash, Write et Edit, `bypassPermissions`, et le dossier de
 * travail global en lecture. Une relecture « à froid » y aurait donc lu le code, voire écrit dans le
 * dépôt. Le profil `sans-outil` est le seul qui garantit qu'elle ne voit que ce qu'on lui envoie.
 */
const capture = vi.hoisted(() => ({ cwd: undefined as string | undefined, args: [] as string[] }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (_bin: string, args: string[], options?: { cwd?: string }) => {
    capture.args = args
    capture.cwd = options?.cwd
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    const stdout = new EventEmitter()
    child.stdout = stdout
    child.stderr = new EventEmitter()
    child.stdin = { end: () => undefined }
    child.kill = (): boolean => true
    child.unref = (): void => undefined
    child.exitCode = null
    setTimeout(() => {
      stdout.emit(
        'data',
        Buffer.from(
          `${JSON.stringify({
            type: 'result',
            subtype: 'success',
            result: 'ok',
            session_id: 's',
            is_error: false,
            usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
          })}\n`
        )
      )
      child.emit('close', 0)
    }, 0)
    return child
  }
}))

const dossier = mkdtempSync(join(tmpdir(), 'autowin-sans-outil-'))
const envInitial = process.env[AUTOWIN_WORKSPACE_ENV]
afterEach(() => {
  if (envInitial === undefined) delete process.env[AUTOWIN_WORKSPACE_ENV]
  else process.env[AUTOWIN_WORKSPACE_ENV] = envInitial
})
afterAll(() => rmSync(dossier, { recursive: true, force: true }))

async function argsDuSpawn(options: SendOptions): Promise<string[]> {
  process.env[AUTOWIN_WORKSPACE_ENV] = dossier
  const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
    [{ role: 'user', content: 'bonjour' }],
    options
  )
  let step = await stream.next()
  while (!step.done) step = await stream.next()
  return capture.args
}

describe('profil sans-outil', () => {
  it('ne charge aucun outil, même quand un dossier de travail existe', async () => {
    const args = await argsDuSpawn({ toolProfile: 'sans-outil' })
    expect(args[args.indexOf('--tools') + 1]).toBe('')
    expect(args).not.toContain('--allowedTools')
    expect(args).not.toContain('--permission-mode')
    expect(args).not.toContain('--add-dir')
    expect(capture.cwd).not.toBe(dossier)
  })

  it('jumeau : sans ce profil, un appel sans execution reste un tour de chat outillé', async () => {
    const args = await argsDuSpawn({})
    expect(args[args.indexOf('--tools') + 1]).toContain('Bash')
    expect(args).toContain('--permission-mode')
    expect(capture.cwd).toBe(dossier)
  })
})
