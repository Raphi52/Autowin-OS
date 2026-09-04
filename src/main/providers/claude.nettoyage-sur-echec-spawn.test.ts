import { EventEmitter } from 'node:events'
import { readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { ClaudeCliAdapter } from './claude'

/*
 * FUITE MESUREE : 39 dossiers `autowin-os-system-*` + 39 `autowin-os-settings-*` orphelins dans
 * %TEMP% (4 sept.). Un couple par appel AVORTE : le nettoyage n'etait branche que sur `close`,
 * jamais sur `error`. Un spawn qui echoue laissait donc ses deux dossiers derriere lui.
 */
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end: (): void => {} }
    child.kill = (): boolean => true
    child.unref = (): void => {}
    child.exitCode = null
    setTimeout(() => child.emit('error', new Error('spawn ENOENT')), 0)
    return child
  }
}))

const temporairesAutowin = (): string[] =>
  readdirSync(tmpdir()).filter(
    (nom) => nom.startsWith('autowin-os-system-') || nom.startsWith('autowin-os-settings-')
  )

describe('claude — un appel avorte ne laisse aucun temporaire', () => {
  it('nettoie system-prompt et settings quand le spawn echoue', async () => {
    const avant = new Set(temporairesAutowin())

    const gen = new ClaudeCliAdapter({ bin: 'claude' }).send([{ role: 'user', content: 'Salut' }], {
      system: 'S'.repeat(5_000)
    })
    await expect(
      (async () => {
        for await (const _ of gen) void _
      })()
    ).rejects.toThrow()

    expect(temporairesAutowin().filter((nom) => !avant.has(nom))).toEqual([])
  })
})
