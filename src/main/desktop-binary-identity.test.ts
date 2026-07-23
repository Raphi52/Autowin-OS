import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const IDENTITY_FIELDS = ['executable', 'executableSha256', 'executableVersion'] as const

describe('identité du binaire desktop', () => {
  it('publie les mêmes champs d’identité depuis le headless et le raccourci', () => {
    const headless = readFileSync(join(ROOT, 'scripts/autowin-headless.ps1'), 'utf8')
    const shortcut = readFileSync(join(ROOT, 'scripts/refresh-desktop-shortcut.ps1'), 'utf8')

    for (const field of IDENTITY_FIELDS) {
      expect(headless).toContain(field)
      expect(shortcut).toContain(field)
    }
  })

  it.runIf(process.platform === 'win32')(
    'rapporte dans Status le SHA-256 de l’exécutable effectivement sélectionné',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'autowin-headless-identity-'))
      const executable = join(root, 'fixture.exe')
      const bytes = Buffer.from('autowin identity fixture\n', 'utf8')
      writeFileSync(executable, bytes)

      try {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(ROOT, 'scripts/autowin-headless.ps1'),
            '-Action',
            'Status',
            '-InstanceId',
            'identity-contract',
            '-Port',
            '9269',
            '-Executable',
            executable,
            '-InstancesRoot',
            join(root, 'instances')
          ],
          { encoding: 'utf8' }
        )

        expect(result.status).toBe(1)
        expect(result.stderr).toBe('')
        const payload = JSON.parse(result.stdout.trim()) as Record<string, unknown>
        expect(payload).toMatchObject({
          instanceId: 'identity-contract',
          running: false,
          executableSha256: createHash('sha256').update(bytes).digest('hex')
        })
        expect(payload).toHaveProperty('executable')
        expect(String(payload.executable)).toMatch(/[\\/]fixture\.exe$/i)
        expect(payload).toHaveProperty('executableVersion')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
