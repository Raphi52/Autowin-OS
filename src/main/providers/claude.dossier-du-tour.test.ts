import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCliAdapter } from './claude'
import { AUTOWIN_WORKSPACE_ENV } from '../../shared/app-identity'

/**
 * LE DOSSIER DU TOUR PRIME SUR LE DOSSIER GLOBAL (2026-09-08).
 *
 * Le cwd d'un tour de chat etait lu dans `process.env[AUTOWIN_WORKSPACE_ENV]` — une valeur figee au
 * demarrage de l'app et partagee par TOUTES les conversations. Le controleur resout desormais le
 * dossier depuis la conversation courante et le PASSE (`workspaceCwd`) : sans cette priorite, deux
 * conversations rangees dans deux projets travailleraient encore dans le meme dossier.
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

const roots: string[] = []
const envInitial = process.env[AUTOWIN_WORKSPACE_ENV]
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  if (envInitial === undefined) delete process.env[AUTOWIN_WORKSPACE_ENV]
  else process.env[AUTOWIN_WORKSPACE_ENV] = envInitial
})

const dossierTemporaire = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'autowin-dossier-tour-'))
  roots.push(root)
  return root
}

async function cwdDuSpawn(workspaceCwd?: string): Promise<string | undefined> {
  const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
    [{ role: 'user', content: 'bonjour' }],
    workspaceCwd ? { workspaceCwd } : {}
  )
  let step = await stream.next()
  while (!step.done) step = await stream.next()
  return capture.cwd
}

describe('tour de chat — le dossier passe pilote le cwd', () => {
  it('utilise le dossier du tour plutot que le dossier global', async () => {
    const global = dossierTemporaire()
    const duTour = dossierTemporaire()
    process.env[AUTOWIN_WORKSPACE_ENV] = global
    expect(await cwdDuSpawn(duTour)).toBe(duTour)
  })

  it('sans dossier passe, retombe sur le dossier global', async () => {
    const global = dossierTemporaire()
    process.env[AUTOWIN_WORKSPACE_ENV] = global
    expect(await cwdDuSpawn()).toBe(global)
  })
})
