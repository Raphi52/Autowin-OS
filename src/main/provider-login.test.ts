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
  it('spawn un terminal PowerShell détaché exécutant la commande, et unref', () => {
    const unref = vi.fn()
    const spawnFn = vi.fn(() => ({ unref })) as unknown as typeof import('node:child_process').spawn
    spawnLoginTerminal('claude auth login', { spawnFn })
    expect(spawnFn).toHaveBeenCalledWith(
      'powershell.exe',
      ['-NoExit', '-Command', 'claude auth login'],
      expect.objectContaining({ detached: true, stdio: 'ignore' })
    )
    expect(unref).toHaveBeenCalled()
  })
  it('passe cwd quand fourni (codex → racine repo pour npm run)', () => {
    const spawnFn = vi.fn(() => ({ unref: vi.fn() })) as unknown as typeof import('node:child_process').spawn
    spawnLoginTerminal('npm run codex:login', { spawnFn, cwd: 'C:\\Amitel\\Autowin OS' })
    expect(spawnFn).toHaveBeenCalledWith(
      'powershell.exe',
      expect.any(Array),
      expect.objectContaining({ cwd: 'C:\\Amitel\\Autowin OS' })
    )
  })
})
