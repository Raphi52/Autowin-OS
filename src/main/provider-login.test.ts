import { describe, expect, it, vi } from 'vitest'
import { planProviderLogin, spawnLoginTerminal } from './provider-login'

describe('planProviderLogin', () => {
  it('claude sans compte vise → login `claude auth login`, dossier herite PURGE', () => {
    // La purge est le correctif du 2026-09-01 : un CLAUDE_CONFIG_DIR herite du shell parent
    // faisait authentifier le dossier d'un AUTRE compte, ce qui « remplacait » le compte courant.
    expect(planProviderLogin('claude')).toEqual({
      kind: 'terminal',
      command: 'Remove-Item Env:CLAUDE_CONFIG_DIR -ErrorAction SilentlyContinue; claude auth login'
    })
  })
  it('MOTEURS RETIRÉS : Codex, Kimi et Gemini n’ont plus AUCUN plan de connexion', () => {
    // Contrôle négatif du retrait : réinjecter l'un de ces moteurs doit lever ici, plutôt
    // qu'ouvrir une console sur un moteur qui n'est plus branché (cf. routed-providers.ts).
    expect(() => planProviderLogin('codex')).toThrow(/Aucun login connu/)
    expect(() => planProviderLogin('kimi')).toThrow(/Aucun login connu/)
    expect(() => planProviderLogin('gemini')).toThrow(/Aucun login connu/)
  })
  it('provider inconnu → throw', () => {
    expect(() => planProviderLogin('provider-inconnu')).toThrow(/Aucun login connu/)
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
