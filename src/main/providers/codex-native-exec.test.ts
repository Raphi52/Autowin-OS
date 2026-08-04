import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CODEX_PACKAGE_ENTRY, codexExecSpec } from './codex'

describe('Codex CLI — lancement Windows sans wrapper console', () => {
  it('lance directement le binaire natif quand le paquet npm le fournit', () => {
    const appData = 'C:\\AppData'
    const entrypoint = join(appData, 'npm', CODEX_PACKAGE_ENTRY)
    const packageRoot = join(appData, 'npm', 'node_modules', '@openai', 'codex')
    const native = join(
      packageRoot,
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe'
    )

    const spec = codexExecSpec(
      'C:\\repo',
      'gpt-5.6-sol',
      'workspace-write',
      'high',
      appData,
      (path) => path === entrypoint || path === native
    )

    expect(spec.executable).toBe(native)
    expect(spec.args[0]).toBe('exec')
    expect(spec.args).not.toContain(entrypoint)
  })
})
