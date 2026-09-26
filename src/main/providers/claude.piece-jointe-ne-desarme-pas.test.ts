import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCliAdapter } from './claude'
import { AUTOWIN_WORKSPACE_ENV } from '../../shared/app-identity'

/**
 * UNE PIECE JOINTE NE DESARME PAS LE TOUR DE CHAT — mesure conv-650 (2026-09-17).
 *
 * `send()` materialise les pieces jointes du fil ENTIER (agent-pilot, depuis le 2026-08-27) : des
 * qu'une image a ete jointe une fois, TOUS les tours suivants ont `materialized`. La branche
 * `else if (materialized)` passait alors avant la branche « tour de chat » : outils reduits a
 * `Read,WebFetch,WebSearch` ET aucun cwd transmis au spawn — le CLI repartait donc dans le dossier
 * du PROCESSUS (D:\AutoWinOS) au lieu du dossier range sur la conversation.
 *
 * Preuve dans le dossier de conv-650, turnId 5bd288bc-7617-4ab7-9810-3acfbed17c23 :
 * argv `--tools Read,WebFetch,WebSearch`, puis quatre refus d'ecriture d'affilee
 * (saisies ts 1789639857023, 1789639927623, 1789640030803, 1789640116782).
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
  const root = mkdtempSync(join(tmpdir(), 'autowin-piece-jointe-'))
  roots.push(root)
  return root
}

async function tourAvecPieceJointe(workspaceCwd: string): Promise<void> {
  const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
    [
      {
        role: 'user',
        content: 'applique le fond blanc',
        attachments: [
          {
            name: 'capture.png',
            mimeType: 'image/png',
            size: 3,
            kind: 'image',
            content: Buffer.from('png').toString('base64')
          }
        ]
      }
    ],
    { workspaceCwd }
  )
  let step = await stream.next()
  while (!step.done) step = await stream.next()
}

describe('tour de chat avec piece jointe', () => {
  it('garde le dossier de la conversation comme cwd', async () => {
    const duTour = dossierTemporaire()
    process.env[AUTOWIN_WORKSPACE_ENV] = dossierTemporaire()
    await tourAvecPieceJointe(duTour)
    expect(capture.cwd).toBe(duTour)
  })

  it('garde les outils de mutation (Write, Edit, Bash)', async () => {
    const duTour = dossierTemporaire()
    await tourAvecPieceJointe(duTour)
    expect(capture.args).toContain('Write')
    expect(capture.args).toContain('Edit')
    expect(capture.args).toContain('Bash')
  })

  it('ouvre en lecture le dossier temporaire des pieces jointes', async () => {
    const duTour = dossierTemporaire()
    await tourAvecPieceJointe(duTour)
    const dirs = capture.args.filter((_a, i) => capture.args[i - 1] === '--add-dir')
    expect(dirs.some((d) => d.includes('autowin-os-attachments-'))).toBe(true)
  })
})
