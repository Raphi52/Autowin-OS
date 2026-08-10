import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PowerShellWindowsRelay,
  isolatedRelayLaunchArguments,
  taskOccurrenceFromAdditionalData,
  windowsRelayTaskName
} from './windows-relay'

function probeLegacyDisarm(
  legacyArguments: string,
  ownerArgument: string,
  migrateUnscoped = false
): string {
  const bridge = join(process.cwd(), 'resources', 'autowin-task-relay.ps1').replaceAll("'", "''")
  const command = [
    `$legacyArguments = '${legacyArguments.replaceAll("'", "''")}'`,
    'function Get-ScheduledTask { [CmdletBinding()] param([string]$TaskName) if ($TaskName -eq "Legacy") { [pscustomobject]@{ Actions = @([pscustomobject]@{ Arguments = $legacyArguments }) } } }',
    'function Unregister-ScheduledTask { [CmdletBinding(SupportsShouldProcess=$true, ConfirmImpact="None")] param([string]$TaskName) "REMOVED:$TaskName" }',
    `& '${bridge}' -Action Disarm -TaskName 'Hash-A' -LegacyTaskName 'Legacy' -LegacyOwnerArgument '${ownerArgument.replaceAll("'", "''")}'${migrateUnscoped ? ' -MigrateUnscopedLegacy' : ''}`
  ].join('\n')
  return execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], {
    encoding: 'utf8'
  })
}

describe('Task Manager — relais Windows unique', () => {
  it('branche un nom de tache Windows propre a la racine canonique', () => {
    const indexSource = readFileSync(join(process.cwd(), 'src/main/index.ts'), 'utf8')
    const e2eSource = readFileSync(join(process.cwd(), 'scripts/cdp-task-manager-e2e.mjs'), 'utf8')
    const relayAt = indexSource.indexOf('const relay = new PowerShellWindowsRelay({')
    const relayBranch = indexSource.slice(relayAt, relayAt + 600)

    expect(relayAt).toBeGreaterThanOrEqual(0)
    expect(relayBranch).toContain("taskName: windowsRelayTaskName(app.getPath('userData'))")
    expect(relayBranch).toContain('migrateUnscopedLegacy: !explicitUserDataDir')
    expect(windowsRelayTaskName('C:\\Profils\\A\\autowin-os')).toBe(
      windowsRelayTaskName('c:\\profils\\a\\autowin-os')
    )
    expect(windowsRelayTaskName('C:\\Profils\\A\\autowin-os')).not.toBe(
      windowsRelayTaskName('C:\\Profils\\B\\autowin-os')
    )
    expect(windowsRelayTaskName('C:\\Profils\\A\\autowin-os').length).toBeLessThanOrEqual(64)
    expect(e2eSource).toContain(
      'const relayTaskName = `Autowin OS - Prompt Relay - ${relayTaskSuffix}`'
    )
    expect(e2eSource).not.toContain("const relayTaskName = 'Autowin OS - Prompt Relay'")
  })

  it('conserve chaque option technique isolée dans un argument distinct', () => {
    expect(
      isolatedRelayLaunchArguments({
        isolated: true,
        remoteDebuggingPort: '9254 --user-data-dir=C:\\profil reel',
        userDataPath: 'C:\\Autowin Test\\user-data'
      })
    ).toEqual([
      '--remote-debugging-port=9254',
      '--user-data-dir=C:\\Autowin Test\\user-data',
      '--isolated-test-instance',
      '--headless-test-instance'
    ])
  })

  it('transmet aussi le profil canonique d une instance non isolee', () => {
    expect(
      isolatedRelayLaunchArguments({
        isolated: false,
        remoteDebuggingPort: '',
        userDataPath: 'C:\\profil\\app-data\\autowin-os'
      })
    ).toEqual(['--user-data-dir=C:\\profil\\app-data\\autowin-os'])
  })

  it('récupère l’occurrence transmise par les données du verrou Electron', () => {
    expect(
      taskOccurrenceFromAdditionalData({ autowinTaskOccurrence: 'task-7@1785742200000' })
    ).toBe('task-7@1785742200000')
    expect(taskOccurrenceFromAdditionalData({ autowinTaskOccurrence: 'task-7' })).toBeUndefined()
    expect(taskOccurrenceFromAdditionalData(null)).toBeUndefined()
  })

  it('arme WakeToRun sans rattrapage et ne transmet que l’identifiant d’occurrence', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        available: true,
        scheduledFor: 1785742200000,
        wakeToRun: true,
        startWhenAvailable: false,
        multipleInstances: 'IgnoreNew'
      }),
      stderr: ''
    })
    const relay = new PowerShellWindowsRelay({
      scriptPath: 'C:\\Autowin\\resources\\autowin-task-relay.ps1',
      executablePath: 'C:\\Autowin\\autowin-os.exe',
      launchArguments: ['--user-data-dir=C:\\Autowin Test\\user-data', '--isolated-test-instance'],
      run
    })

    const result = await relay.arm(1785742200000, 'task-7@1785742200000')

    expect(result).toMatchObject({
      available: true,
      wakeToRun: true,
      startWhenAvailable: false,
      multipleInstances: 'IgnoreNew'
    })
    const args = run.mock.calls[0][1] as string[]
    expect(args).toContain('task-7@1785742200000')
    expect(args.join(' ')).not.toContain('prompt secret')
    expect(args).toContain('-ScheduledForEpochMs')
    const legacyTaskNameIndex = args.indexOf('-LegacyTaskName')
    expect(legacyTaskNameIndex).toBeGreaterThan(0)
    expect(args[legacyTaskNameIndex + 1]).toBe('Autowin OS - Prompt Relay')
    const legacyOwnerIndex = args.indexOf('-LegacyOwnerArgument')
    expect(legacyOwnerIndex).toBeGreaterThan(0)
    expect(args[legacyOwnerIndex + 1]).toBe('--user-data-dir=C:\\Autowin Test\\user-data')
    const launchArgumentsIndex = args.indexOf('-LaunchArgumentsB64')
    expect(launchArgumentsIndex).toBeGreaterThan(0)
    expect(
      JSON.parse(Buffer.from(args[launchArgumentsIndex + 1], 'base64url').toString('utf8'))
    ).toEqual(['--user-data-dir=C:\\Autowin Test\\user-data', '--isolated-test-instance'])
  })

  it('désarme le relais lorsqu’aucune tâche Windows ne reste', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        available: true,
        scheduledFor: null,
        wakeToRun: true,
        startWhenAvailable: false,
        multipleInstances: 'IgnoreNew'
      }),
      stderr: ''
    })
    const relay = new PowerShellWindowsRelay({
      scriptPath: 'C:\\Autowin\\resources\\autowin-task-relay.ps1',
      executablePath: 'C:\\Autowin\\autowin-os.exe',
      migrateUnscopedLegacy: true,
      run
    })

    await relay.arm(null, null)

    expect(run.mock.calls[0][1]).toContain('Disarm')
    expect(run.mock.calls[0][1]).toContain('-MigrateUnscopedLegacy')
  })

  it.runIf(process.platform === 'win32')(
    'un profil A vide conserve le relais historique appartenant au profil B',
    () => {
      const output = probeLegacyDisarm(
        '--autowin-task-dispatch --user-data-dir=C:\\Profils\\B\\autowin-os',
        '--user-data-dir=C:\\Profils\\A\\autowin-os'
      )

      expect(output).not.toContain('REMOVED:Legacy')
    }
  )

  it.runIf(process.platform === 'win32')(
    'retire seulement le relais historique du meme profil et le legacy non scope du profil par defaut',
    () => {
      const owner = '--user-data-dir=C:\\Profils\\A\\autowin-os'

      expect(probeLegacyDisarm(`--autowin-task-dispatch ${owner}`, owner)).toContain(
        'REMOVED:Legacy'
      )
      const spacedOwner = '--user-data-dir=C:\\Autowin Test\\autowin-os'
      expect(probeLegacyDisarm(`--autowin-task-dispatch "${spacedOwner}"`, spacedOwner)).toContain(
        'REMOVED:Legacy'
      )
      expect(probeLegacyDisarm('--autowin-task-dispatch', owner, true)).toContain('REMOVED:Legacy')
    }
  )

  it('échoue fermé si les réglages Windows relus ne respectent pas le contrat', async () => {
    const relay = new PowerShellWindowsRelay({
      scriptPath: 'relay.ps1',
      executablePath: 'autowin-os.exe',
      run: vi.fn().mockResolvedValue({
        stdout: JSON.stringify({
          available: true,
          scheduledFor: 1785742200000,
          wakeToRun: false,
          startWhenAvailable: true,
          multipleInstances: 'Parallel'
        }),
        stderr: ''
      })
    })

    await expect(relay.arm(1785742200000, 'task-7@1785742200000')).rejects.toThrow(
      /contrat de réveil/i
    )
  })

  it('utilise le nom LogonType réellement accepté par le module ScheduledTasks Windows', () => {
    const bridge = readFileSync(join(process.cwd(), 'resources', 'autowin-task-relay.ps1'), 'utf8')
    expect(bridge).toContain('-LogonType Interactive')
    expect(bridge).not.toContain('-LogonType InteractiveToken')
    expect(bridge).toContain('foreach ($launchArgument in $decodedLaunchArguments)')
    expect(bridge).toContain('[string]$LegacyTaskName = ""')
    expect(bridge).toContain('Unregister-ScheduledTask -TaskName $LegacyTaskName -Confirm:$false')
    expect(bridge.lastIndexOf('\nRemove-OwnedLegacyRelayTask')).toBeGreaterThan(
      bridge.indexOf('Register-ScheduledTask -TaskName $TaskName')
    )
  })
})
