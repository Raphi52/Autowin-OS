import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { maybeUpdateClaudeCli } from './claude-cli-update'

/**
 * Banc de la mise a jour du CLI Claude — la SOURCE de la liste de modeles. Cas reel du 2026-09-09 :
 * `claude-fable-5-1` n'apparaissait nulle part parce que le binaire installe (2.1.251) ne le
 * contenait pas ; `claude update` (2.1.266) l'a fait apparaitre.
 */
describe('mise a jour automatique du CLI Claude', () => {
  const dirs: string[] = []
  const stamp = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'autowin-cli-update-'))
    dirs.push(dir)
    return join(dir, 'claude-cli-update.json')
  }
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('lance la mise a jour la premiere fois et rend son dernier message', async () => {
    const run = vi.fn(async () => ({
      code: 0,
      output: 'Checking for updates...\nSuccessfully updated from 2.1.251 to version 2.1.266\n'
    }))
    const path = stamp()

    const result = await maybeUpdateClaudeCli(path, { run, bin: 'claude', now: 1_000 })

    expect(run).toHaveBeenCalledTimes(1)
    expect(result).toEqual({
      outcome: 'updated',
      detail: 'Successfully updated from 2.1.251 to version 2.1.266'
    })
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ attemptedAt: 1_000 })
  })

  it('ne relance rien tant que la fenetre n’est pas ecoulee', async () => {
    const run = vi.fn(async () => ({ code: 0, output: 'ok' }))
    const path = stamp()

    await maybeUpdateClaudeCli(path, { run, now: 1_000, windowMs: 10_000 })
    const second = await maybeUpdateClaudeCli(path, { run, now: 5_000, windowMs: 10_000 })
    const third = await maybeUpdateClaudeCli(path, { run, now: 20_000, windowMs: 10_000 })

    expect(second).toEqual({ outcome: 'skipped' })
    expect(third.outcome).toBe('updated')
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('une mise a jour impossible est un ECHEC NOMME, jamais une exception qui casse le demarrage', async () => {
    const run = vi.fn(async () => {
      throw new Error('CLI introuvable')
    })

    const result = await maybeUpdateClaudeCli(stamp(), { run, now: 1 })

    expect(result).toEqual({ outcome: 'failed', detail: 'CLI introuvable' })
  })
})
