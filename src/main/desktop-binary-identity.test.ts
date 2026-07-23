import { createHash } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const IDENTITY_FIELDS = ['executable', 'executableSha256', 'executableVersion'] as const

function powershellLiteral(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

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
      copyFileSync(process.execPath, executable)
      const bytes = readFileSync(executable)

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
        expect(String(payload.executableVersion)).not.toBe('')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform === 'win32')(
    'conserve dans Status l’identité capturée au lancement si le fichier disque dérive',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'autowin-headless-launch-identity-'))
      const executable = join(root, 'fixture.exe')
      const instanceId = 'launch-identity-contract'
      const instancesRoot = join(root, 'instances')
      const instanceRoot = join(instancesRoot, instanceId)
      mkdirSync(instanceRoot, { recursive: true })
      copyFileSync(process.execPath, executable)
      const canonicalExecutable = realpathSync.native(executable)
      writeFileSync(
        join(instanceRoot, 'instance.json'),
        JSON.stringify({
          pid: 2147483647,
          executable: canonicalExecutable,
          executableSha256: 'launch-sha256-sentinel',
          executableVersion: 'launch-version-sentinel',
          port: 9270,
          userData: join(instanceRoot, 'user-data')
        })
      )
      writeFileSync(executable, 'replacement after launch\n')

      try {
        const statusArgs = [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          join(ROOT, 'scripts/autowin-headless.ps1'),
          '-Action',
          'Status',
          '-InstanceId',
          instanceId,
          '-Port',
          '9270',
          '-Executable',
          canonicalExecutable,
          '-InstancesRoot',
          instancesRoot
        ]
        const result = spawnSync('powershell.exe', statusArgs, { encoding: 'utf8' })

        expect(result.status).toBe(1)
        expect(result.stderr).toBe('')
        expect(JSON.parse(result.stdout.trim())).toMatchObject({
          running: false,
          executableSha256: 'launch-sha256-sentinel',
          executableVersion: 'launch-version-sentinel',
          executableDrift: true
        })

        rmSync(executable, { force: true })
        const missing = spawnSync('powershell.exe', statusArgs, { encoding: 'utf8' })
        expect(missing.status).toBe(1)
        expect(missing.stderr).toBe('')
        expect(JSON.parse(missing.stdout.trim())).toMatchObject({
          executableSha256: 'launch-sha256-sentinel',
          executableOnDiskSha256: null,
          executableDrift: true,
          executableDriftReason: 'missing'
        })
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform === 'win32')(
    'crée un raccourci isolé dont la cible égale exactement l’exécutable publié',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'autowin-shortcut-identity-'))
      const executable = join(root, 'dist', 'win-unpacked', 'autowin-os.exe')
      const icon = join(root, 'build', 'icon.ico')
      const shortcut = join(root, 'Autowin OS.lnk')
      mkdirSync(join(root, 'dist', 'win-unpacked'), { recursive: true })
      mkdirSync(join(root, 'build'), { recursive: true })
      copyFileSync(process.execPath, executable)
      copyFileSync(join(ROOT, 'build', 'icon.ico'), icon)
      const canonicalExecutable = realpathSync.native(executable)

      try {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(ROOT, 'scripts/refresh-desktop-shortcut.ps1'),
            '-ProjectRoot',
            root,
            '-ShortcutPath',
            shortcut
          ],
          { encoding: 'utf8' }
        )
        expect(result.status, result.stderr).toBe(0)
        const identity = JSON.parse(result.stdout.trim().split(/\r?\n/).at(-1) ?? '{}') as Record<
          string,
          unknown
        >
        const inspected = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-Command',
            `$shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut(${powershellLiteral(shortcut)}); $shortcut.TargetPath`
          ],
          { encoding: 'utf8' }
        )

        expect(inspected.status, inspected.stderr).toBe(0)
        expect(String(inspected.stdout).trim().toLowerCase()).toBe(
          String(identity.executable).toLowerCase()
        )
        expect(String(identity.executable).toLowerCase()).toBe(canonicalExecutable.toLowerCase())
        expect(identity.executableSha256).toBe(
          createHash('sha256').update(readFileSync(executable)).digest('hex')
        )
        expect(String(identity.executableVersion)).not.toBe('')
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )

  it.runIf(process.platform === 'win32')(
    'refuse de créer un raccourci vers un exécutable sans version publiée',
    () => {
      const root = mkdtempSync(join(tmpdir(), 'autowin-shortcut-versionless-'))
      const executable = join(root, 'dist', 'win-unpacked', 'autowin-os.exe')
      const icon = join(root, 'build', 'icon.ico')
      const shortcut = join(root, 'Autowin OS.lnk')
      mkdirSync(join(root, 'dist', 'win-unpacked'), { recursive: true })
      mkdirSync(join(root, 'build'), { recursive: true })
      writeFileSync(executable, 'versionless executable fixture')
      copyFileSync(join(ROOT, 'build', 'icon.ico'), icon)

      try {
        const result = spawnSync(
          'powershell.exe',
          [
            '-NoProfile',
            '-ExecutionPolicy',
            'Bypass',
            '-File',
            join(ROOT, 'scripts/refresh-desktop-shortcut.ps1'),
            '-ProjectRoot',
            root,
            '-ShortcutPath',
            shortcut
          ],
          { encoding: 'utf8' }
        )

        expect(result.status).toBe(1)
        expect(result.stderr).toMatch(/version/i)
        expect(existsSync(shortcut)).toBe(false)
      } finally {
        rmSync(root, { recursive: true, force: true })
      }
    }
  )
})
