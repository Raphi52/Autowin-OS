import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ClaudeCliAdapter } from './claude'

/**
 * UN AGENT QUI OBSERVE DOIT POUVOIR EXECUTER — sinon il ne peut RIEN prouver.
 *
 * Defaut mesure sur conv-155, tour `20f856a2-8dd5-4e78-b98b-f7c7319afd12` : la phase `judge` de
 * `/judge la skill /arena` a rendu « Bash is disabled for this session, in subagents as well as
 * here » et a du fermer ses objections « par lecture ». Consequence directe dans le meme tour : le
 * juge ecrit « aucun test n'a ete lance » et baisse sa note. La cause n'est pas le CLI : c'est la
 * confusion, dans le spawn, entre « ne doit pas ECRIRE » (sandbox read-only) et « ne doit pas
 * EXECUTER » — la liste d'outils retirait Bash en meme temps que Write/Edit.
 *
 * Demande utilisateur (saisie du 2026-09-02, ts 1788376585435) : « tu dois pouvoir faire ca partout
 * pour tout en toute circonstances ». Le shell devient donc une capacite de base des executions.
 * Ce qui RESTE ferme en read-only : Write, Edit, MultiEdit — les outils d'ecriture nommes.
 */

const capture = vi.hoisted(() => ({ args: [] as string[] }))
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (_bin: string, args: string[]) => {
    capture.args = args
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
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function argsPourSandbox(
  sandbox: 'read-only' | 'danger-full-access'
): Promise<{ tools: string; allowed: string[] }> {
  const root = mkdtempSync(join(tmpdir(), 'autowin-claude-readonly-shell-'))
  roots.push(root)
  const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
    [{ role: 'user', content: 'verifie' }],
    { execution: { cwd: root, sandbox } }
  )
  let step = await stream.next()
  while (!step.done) step = await stream.next()
  const tools = capture.args[capture.args.indexOf('--tools') + 1] ?? ''
  return { tools, allowed: capture.args }
}

describe('execution read-only — le shell reste ouvert', () => {
  it('CHARGE Bash en read-only (une phase qui observe doit pouvoir sortir un code de sortie)', async () => {
    const { tools } = await argsPourSandbox('read-only')
    expect(tools).toMatch(/(^|,)Bash(,|$)/)
  })

  it('AUTORISE Bash nu en read-only, pas seulement charge', async () => {
    const { allowed } = await argsPourSandbox('read-only')
    expect(allowed).toContain('Bash')
  })

  it("n'ouvre AUCUN outil d'ecriture en read-only", async () => {
    const { tools, allowed } = await argsPourSandbox('read-only')
    for (const interdit of ['Write', 'Edit', 'MultiEdit']) {
      expect(tools).not.toMatch(new RegExp(`(^|,)${interdit}(,|$)`))
      expect(allowed).not.toContain(interdit)
    }
  })

  it('garde ecriture + shell en danger-full-access', async () => {
    const { tools, allowed } = await argsPourSandbox('danger-full-access')
    expect(tools).toMatch(/(^|,)Bash(,|$)/)
    expect(allowed).toContain('Write')
    expect(allowed).toContain('Edit')
  })
})
