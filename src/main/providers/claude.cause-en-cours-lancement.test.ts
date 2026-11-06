import { EventEmitter } from 'node:events'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { sandboxForPhase } from '../orchestration/orchestrator'
import { ClaudeCliAdapter, signalDeCauseDuLancement } from './claude'
import { OUTILS_D_EDITION } from './cause-en-cours'

/**
 * LE SIGNAL DE CAUSE TOURNE LÀ OÙ LE CONTRÔLE FINAL S'APPLIQUE (conv-1353, 2026-10-31).
 *
 * Piège de la demande : l'avertissement des tests n'est posé qu'en tour de chat. Le contrôle final,
 * lui, s'applique aux agents de run (étapes de build et réparations), qui passent par `send` avec
 * `execution`. Ce banc lance donc le VRAI `send`, intercepte le lancement du CLI et lit les réglages
 * qu'il aurait reçus, tant que leur dossier temporaire existe encore.
 */

interface Lancement {
  reglages: { hooks: Record<string, { matcher: string; hooks: { command: string }[] }[]> }
  dossier: string
  scriptCause?: string
}

const capture = vi.hoisted(() => ({
  lancement: undefined as unknown as Lancement,
  apresLancement: undefined as undefined | ((l: Lancement) => void)
}))

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: (_bin: string, args: string[]) => {
    const fichier = args[args.indexOf('--settings') + 1]
    const reglages = JSON.parse(readFileSync(fichier, 'utf8')) as Lancement['reglages']
    capture.lancement = { reglages, dossier: dirname(fichier) }
    capture.apresLancement?.(capture.lancement)
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
  capture.apresLancement = undefined
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const dossierDuRun = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'autowin-cause-lancement-'))
  roots.push(root)
  mkdirSync(join(root, '.git'))
  return root
}

async function lancer(opts: Parameters<ClaudeCliAdapter['send']>[1]): Promise<Lancement> {
  const stream = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
    [{ role: 'user', content: 'modifie' }],
    opts
  )
  let step = await stream.next()
  while (!step.done) step = await stream.next()
  return capture.lancement
}

const matchers = (l: Lancement, evenement: string): string[] =>
  (l.reglages.hooks[evenement] ?? []).map((g) => g.matcher)

describe('lancement réel — le signal de cause suit l’agent de run', () => {
  it('une étape de build, avec le vrai niveau de droits d’un run, reçoit le hook', async () => {
    const cwd = dossierDuRun()
    const l = await lancer({ execution: { cwd, sandbox: sandboxForPhase('tâche', 'build') } })
    expect(matchers(l, 'PostToolUse')).toEqual([OUTILS_D_EDITION])
    expect(matchers(l, 'PostToolUseFailure')).toEqual([OUTILS_D_EDITION])
  })

  it('une réparation reprend sa session par le même chemin : elle le reçoit aussi', async () => {
    const cwd = dossierDuRun()
    const l = await lancer({
      resumeSessionId: 'session-du-build',
      execution: { cwd, sandbox: sandboxForPhase('tâche', 'build') }
    })
    expect(matchers(l, 'PostToolUse')).toEqual([OUTILS_D_EDITION])
  })

  it('le script posé tourne vraiment, à la racine du run, et son état reste dans ses réglages', async () => {
    const cwd = dossierDuRun()
    const fichier = join(cwd, 'src', 'main', 'bureau', 'navigateur-integre.ts')
    let sorties: string[] = []
    let etat = false
    capture.apresLancement = (l) => {
      const commande = l.reglages.hooks.PostToolUse[0].hooks[0].command
      const script = /^node "(.+)"$/.exec(commande)?.[1] as string
      const entree = JSON.stringify({
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: fichier, old_string: 'a', new_string: 'b' }
      })
      sorties = [1, 2, 3].map(
        () =>
          spawnSync(process.execPath, [script], { input: entree, encoding: 'utf8' })
            .stdout as string
      )
      etat = existsSync(join(l.dossier, 'cause-en-cours.json'))
    }
    await lancer({ execution: { cwd, sandbox: sandboxForPhase('tâche', 'build') } })
    expect(sorties.slice(0, 2)).toEqual(['', ''])
    expect(sorties[2]).toContain('3 édits de src/main/bureau/navigateur-integre.ts')
    expect(etat).toBe(true)
  })

  it('une exécution en lecture seule ne modifie rien : pas de hook', async () => {
    const l = await lancer({ execution: { cwd: dossierDuRun(), sandbox: 'read-only' } })
    expect(matchers(l, 'PostToolUse')).toEqual([])
  })

  it('un tour de chat garde son avertissement des tests, sans le signal de cause', async () => {
    const l = await lancer({ conversationId: 'conv-1', workspaceCwd: dossierDuRun() })
    expect(matchers(l, 'PostToolUse')).toEqual(['Bash'])
    expect(matchers(l, 'PostToolUseFailure')).toEqual(['Bash'])
  })
})

describe('signalDeCauseDuLancement — une panne n’emporte pas les gardes', () => {
  it('écriture impossible : pas de hook, sans lever (le lancement garde ses réglages)', async () => {
    const racine = dossierDuRun()
    const dossierAbsent = join(racine, 'dossier-absent')
    await expect(
      signalDeCauseDuLancement(dossierAbsent, { cwd: racine, sandbox: 'danger-full-access' })
    ).resolves.toBeUndefined()
  })

  it('sans `execution` ou en lecture seule : aucun script écrit', async () => {
    const racine = dossierDuRun()
    writeFileSync(join(racine, 'temoin.txt'), '', 'utf8')
    await expect(signalDeCauseDuLancement(racine, undefined)).resolves.toBeUndefined()
    await expect(
      signalDeCauseDuLancement(racine, { cwd: racine, sandbox: 'read-only' })
    ).resolves.toBeUndefined()
    expect(existsSync(join(racine, 'cause-en-cours.mjs'))).toBe(false)
  })
})
