import { EventEmitter } from 'node:events'
import type { spawn } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { ARGUMENTS_RENOUVELLEMENT, renouvelerSessionClaude } from './claude-session-renewal'

/** Faux processus fils : on choisit quand il se ferme ou echoue. */
function fauxSpawn(): {
  spawnFn: typeof spawn
  appels: Array<{ bin: string; args: readonly string[]; options: Record<string, unknown> }>
  enfant: EventEmitter & { kill: ReturnType<typeof vi.fn> }
} {
  const enfant = Object.assign(new EventEmitter(), { kill: vi.fn() })
  const appels: Array<{ bin: string; args: readonly string[]; options: Record<string, unknown> }> =
    []
  const spawnFn = ((bin: string, args: readonly string[], options: Record<string, unknown>) => {
    appels.push({ bin, args, options })
    return enfant
  }) as unknown as typeof spawn
  return { spawnFn, appels, enfant }
}

describe('renouvelerSessionClaude', () => {
  it('lance le CLI dans le dossier du compte, sans réglages ni outils utilisateur', async () => {
    const { spawnFn, appels, enfant } = fauxSpawn()
    const resultat = renouvelerSessionClaude('D:/comptes/compte-3', {
      spawnFn,
      bin: () => 'claude.exe'
    })
    enfant.emit('close', 0)

    expect(await resultat).toBe(true)
    expect(appels).toHaveLength(1)
    expect(appels[0].bin).toBe('claude.exe')
    expect(appels[0].args).toEqual([...ARGUMENTS_RENOUVELLEMENT])
    // `--tools` est variadique : en dernier, sinon il avale le prompt.
    expect(appels[0].args.slice(-2)).toEqual(['--tools', ''])
    expect(appels[0].args).toContain('--setting-sources')
    expect(appels[0].options).toMatchObject({ shell: false, windowsHide: true, stdio: 'ignore' })
    expect((appels[0].options.env as Record<string, string>).CLAUDE_CONFIG_DIR).toBe(
      'D:/comptes/compte-3'
    )
  })

  it('compte par défaut : retire le CLAUDE_CONFIG_DIR hérité du processus', async () => {
    vi.stubEnv('CLAUDE_CONFIG_DIR', 'D:/un/autre/compte')
    const { spawnFn, appels, enfant } = fauxSpawn()
    const resultat = renouvelerSessionClaude(undefined, { spawnFn, bin: () => 'claude.exe' })
    enfant.emit('close', 0)
    await resultat
    vi.unstubAllEnvs()

    expect((appels[0].options.env as Record<string, string>).CLAUDE_CONFIG_DIR).toBeUndefined()
  })

  it('une sortie en erreur compte comme un passage (le jeton a pu être renouvelé avant le 429)', async () => {
    const { spawnFn, enfant } = fauxSpawn()
    const resultat = renouvelerSessionClaude('D:/c', { spawnFn, bin: () => 'claude.exe' })
    enfant.emit('close', 1)
    expect(await resultat).toBe(true)
  })

  it('CLI introuvable : rend false sans lever', async () => {
    const { spawnFn, enfant } = fauxSpawn()
    const resultat = renouvelerSessionClaude('D:/c', { spawnFn, bin: () => 'claude.exe' })
    enfant.emit('error', new Error('ENOENT'))
    expect(await resultat).toBe(false)
  })

  it('délai dépassé : arrête CE processus et rend false', async () => {
    const { spawnFn, enfant } = fauxSpawn()
    const resultat = await renouvelerSessionClaude('D:/c', {
      spawnFn,
      bin: () => 'claude.exe',
      delaiMaxMs: 5
    })
    expect(resultat).toBe(false)
    expect(enfant.kill).toHaveBeenCalledOnce()
  })
})
