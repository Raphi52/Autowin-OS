import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  ensureBrainServerStarted,
  resetBrainLaunchAttempt,
  resolveBrainTooling
} from './brain-server-launch'

let tooling: string

beforeEach(() => {
  resetBrainLaunchAttempt()
  tooling = mkdtempSync(join(tmpdir(), 'brain-tooling-'))
})
afterEach(() => {
  rmSync(tooling, { recursive: true, force: true })
})

const makeValidTooling = (): void => {
  mkdirSync(join(tooling, '.venv', 'Scripts'), { recursive: true })
  writeFileSync(join(tooling, '.venv', 'Scripts', 'python.exe'), '')
  writeFileSync(join(tooling, 'brain_server.py'), '')
}

describe('ensureBrainServerStarted', () => {
  it('no-op si le serveur répond déjà (aucun spawn)', async () => {
    const spawnFn = vi.fn()
    const r = await ensureBrainServerStarted(async () => true, {}, spawnFn as never)
    expect(r.status).toBe('already-up')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('unavailable si le venv/script est absent (aucun spawn)', async () => {
    const spawnFn = vi.fn()
    const r = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: join(tooling, 'nexiste-pas') },
      spawnFn as never
    )
    expect(r.status).toBe('unavailable')
    expect(spawnFn).not.toHaveBeenCalled()
  })

  it('spawn détaché, cwd=tooling, PYTHONPATH retiré, argv=[brain_server.py]', async () => {
    makeValidTooling()
    const child = { unref: vi.fn() }
    const spawnFn = vi.fn().mockReturnValue(child)
    const r = await ensureBrainServerStarted(
      async () => false,
      { AUTOWIN_BRAIN_TOOLING: tooling, PYTHONPATH: '/fuite/hermes' },
      spawnFn as never
    )
    expect(r.status).toBe('starting')
    expect(spawnFn).toHaveBeenCalledOnce()
    const [bin, args, opts] = spawnFn.mock.calls[0]
    expect(bin).toBe(join(tooling, '.venv', 'Scripts', 'python.exe'))
    expect(args).toEqual(['brain_server.py'])
    expect(opts.cwd).toBe(tooling)
    expect(opts.detached).toBe(true)
    expect('PYTHONPATH' in opts.env).toBe(false)
    expect(child.unref).toHaveBeenCalled()
  })

  it('ne tente qu’UNE fois par session (garde anti-spam)', async () => {
    makeValidTooling()
    const spawnFn = vi.fn().mockReturnValue({ unref: vi.fn() })
    const first = await ensureBrainServerStarted(async () => false, { AUTOWIN_BRAIN_TOOLING: tooling }, spawnFn as never)
    const second = await ensureBrainServerStarted(async () => false, { AUTOWIN_BRAIN_TOOLING: tooling }, spawnFn as never)
    expect(first.status).toBe('starting')
    expect(second.status).toBe('unavailable')
    expect(spawnFn).toHaveBeenCalledOnce()
  })

  it('resolveBrainTooling : env override sinon défaut Amitel', () => {
    expect(resolveBrainTooling({ AUTOWIN_BRAIN_TOOLING: 'X:/t' })).toBe('X:/t')
    expect(resolveBrainTooling({})).toContain('Amitel Brain')
  })
})
