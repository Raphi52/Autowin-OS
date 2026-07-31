import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  PowerShellWindowsRelay,
  isolatedRelayLaunchArguments,
  taskOccurrenceFromAdditionalData
} from './windows-relay'

describe('Task Manager — relais Windows unique', () => {
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
      run
    })

    await relay.arm(null, null)

    expect(run.mock.calls[0][1]).toContain('Disarm')
  })

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
  })
})
