import { describe, expect, it, vi } from 'vitest'
import { planProviderLogin, spawnLoginTerminal } from './provider-login'

describe('planProviderLogin', () => {
  it('claude → terminal `claude auth login`', () => {
    expect(planProviderLogin('claude')).toEqual({ kind: 'terminal', command: 'claude auth login' })
  })
  it('codex → terminal `npm run codex:login` (bon store, PAS `codex login`)', () => {
    const plan = planProviderLogin('codex')
    expect(plan).toEqual({ kind: 'terminal', command: 'npm run codex:login' })
    expect((plan as { command: string }).command).not.toBe('codex login')
  })
  it('kimi → délégué à l’adapter', () => {
    expect(planProviderLogin('kimi')).toEqual({ kind: 'adapter', provider: 'kimi' })
  })
  it('provider inconnu → throw', () => {
    expect(() => planProviderLogin('omniroute')).toThrow(/Aucun login connu/)
    expect(() => planProviderLogin('')).toThrow()
  })
})

describe('spawnLoginTerminal', () => {
  it('ouvre une fenêtre VISIBLE via cmd /c start + powershell, la commande après -Command, et unref', () => {
    const unref = vi.fn()
    const spawnFn = vi.fn(() => ({ unref })) as unknown as typeof import('node:child_process').spawn
    spawnLoginTerminal('claude auth login', { spawnFn })
    expect(spawnFn).toHaveBeenCalledTimes(1)
    const [exe, args, options] = (spawnFn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0]
    expect(exe).toBe('cmd.exe')
    // `start` crée une fenêtre visible ; ExecutionPolicy Bypass pour les shims .ps1 ; commande après -Command
    expect(args).toEqual(
      expect.arrayContaining(['/c', 'start', 'powershell', '-ExecutionPolicy', 'Bypass', '-NoExit', '-Command'])
    )
    expect((args as string[])[(args as string[]).length - 1]).toBe('claude auth login')
    expect(options).toMatchObject({ detached: true, stdio: 'ignore', windowsHide: false })
    expect(unref).toHaveBeenCalled()
  })
  it('passe cwd quand fourni (codex → racine repo pour npm run)', () => {
    const spawnFn = vi.fn(() => ({ unref: vi.fn() })) as unknown as typeof import('node:child_process').spawn
    spawnLoginTerminal('npm run codex:login', { spawnFn, cwd: 'C:\\Amitel\\Autowin OS' })
    expect(spawnFn).toHaveBeenCalledWith(
      'cmd.exe',
      expect.any(Array),
      expect.objectContaining({ cwd: 'C:\\Amitel\\Autowin OS' })
    )
  })
})
