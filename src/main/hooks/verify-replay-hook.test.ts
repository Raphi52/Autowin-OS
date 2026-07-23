import { describe, expect, it, vi } from 'vitest'
import { HookBus } from './hook-bus'
import { createVerifyReplayHook } from './verify-replay-hook'

describe('verify-replay hook', () => {
  it('mutation + verif qui PASSE (exit 0) → ne bloque pas', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 0 })
    const bus = new HookBus().register('pre-green', createVerifyReplayHook(run))
    const out = await bus.run('pre-green', { task: 'corrige le bug', verifyCmd: 'npm test', cwd: '/w' })
    expect(out.blocked).toBe(false)
    expect(run).toHaveBeenCalledWith('npm test', '/w')
  })

  it('mutation + verif qui ÉCHOUE (exit 1) → BLOQUE le vert', async () => {
    const run = vi.fn().mockResolvedValue({ exitCode: 1 })
    const bus = new HookBus().register('pre-green', createVerifyReplayHook(run))
    const out = await bus.run('pre-green', { task: 'ajoute une feature', verifyCmd: 'npm test' })
    expect(out.blocked).toBe(true)
    expect(out.reasons[0]).toContain('verify-replay')
  })

  it('tâche NON-mutation (analyse) → pas de replay, pas de blocage', async () => {
    const run = vi.fn()
    const bus = new HookBus().register('pre-green', createVerifyReplayHook(run))
    const out = await bus.run('pre-green', { task: 'analyse le code et explique', verifyCmd: 'npm test' })
    expect(out.blocked).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })

  it('mutation SANS commande de vérif → ne bloque pas (rien à rejouer), runner non appelé', async () => {
    const run = vi.fn()
    const bus = new HookBus().register('pre-green', createVerifyReplayHook(run))
    const out = await bus.run('pre-green', { task: 'corrige le bug' })
    expect(out.blocked).toBe(false)
    expect(run).not.toHaveBeenCalled()
  })
})
