import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { normalize } from 'node:path'
import { promisify } from 'node:util'
import type { RelayState, WindowsRelay } from './task-scheduler'

type ProcessResult = { stdout: string; stderr: string }
type ProcessRunner = (
  executable: string,
  args: string[],
  options?: { timeout?: number; windowsHide?: boolean; encoding?: BufferEncoding }
) => Promise<ProcessResult>

const runProcess = promisify(execFile) as unknown as ProcessRunner
const LEGACY_WINDOWS_RELAY_TASK_NAME = 'Autowin OS - Prompt Relay'

export function windowsRelayTaskName(userDataPath: string): string {
  const identity = normalize(userDataPath).replaceAll('\\', '/').toLowerCase()
  const suffix = createHash('sha256').update(identity, 'utf8').digest('hex').slice(0, 16)
  return `Autowin OS - Prompt Relay - ${suffix}`
}

interface PowerShellWindowsRelayOptions {
  scriptPath: string
  executablePath: string
  taskName?: string
  legacyTaskName?: string
  migrateUnscopedLegacy?: boolean
  launchArguments?: string[]
  run?: ProcessRunner
}

export function isolatedRelayLaunchArguments(options: {
  isolated: boolean
  remoteDebuggingPort: string
  userDataPath: string
}): string[] {
  const profileArgument = `--user-data-dir=${options.userDataPath}`
  // L'identité de données appartient à TOUS les relais. Les drapeaux suivants ne concernent que
  // l'automatisation isolée/headless ; les confondre faisait perdre son store à un parent explicite.
  if (!options.isolated) return [profileArgument]
  const port = options.remoteDebuggingPort.match(/^\d{1,5}/)?.[0]
  return [
    ...(port ? [`--remote-debugging-port=${port}`] : []),
    profileArgument,
    '--isolated-test-instance',
    '--headless-test-instance'
  ]
}

export class PowerShellWindowsRelay implements WindowsRelay {
  private readonly scriptPath: string
  private readonly executablePath: string
  private readonly taskName: string
  private readonly legacyTaskName: string
  private readonly legacyOwnerArgument: string
  private readonly migrateUnscopedLegacy: boolean
  private readonly launchArguments: string[]
  private readonly run: ProcessRunner

  constructor(options: PowerShellWindowsRelayOptions) {
    this.scriptPath = options.scriptPath
    this.executablePath = options.executablePath
    this.taskName = options.taskName ?? LEGACY_WINDOWS_RELAY_TASK_NAME
    this.legacyTaskName = options.legacyTaskName ?? LEGACY_WINDOWS_RELAY_TASK_NAME
    this.launchArguments = options.launchArguments ?? []
    this.legacyOwnerArgument =
      this.launchArguments.find((argument) => argument.startsWith('--user-data-dir=')) ?? ''
    this.migrateUnscopedLegacy = options.migrateUnscopedLegacy ?? false
    this.run = options.run ?? runProcess
  }

  async arm(scheduledFor: number | null, occurrenceId: string | null): Promise<RelayState> {
    if ((scheduledFor === null) !== (occurrenceId === null)) {
      throw new Error('Relais Windows: échéance et occurrence doivent être fournies ensemble')
    }
    const action = scheduledFor === null ? 'Disarm' : 'Arm'
    const args = [
      '-NoLogo',
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      this.scriptPath,
      '-Action',
      action,
      '-TaskName',
      this.taskName,
      '-LegacyTaskName',
      this.legacyTaskName,
      '-LegacyOwnerArgument',
      this.legacyOwnerArgument,
      '-ExecutablePath',
      this.executablePath
    ]
    if (this.migrateUnscopedLegacy) args.push('-MigrateUnscopedLegacy')
    if (scheduledFor !== null && occurrenceId !== null) {
      args.push('-ScheduledForEpochMs', String(scheduledFor), '-OccurrenceId', occurrenceId)
      if (this.launchArguments.length > 0) {
        args.push(
          '-LaunchArgumentsB64',
          Buffer.from(JSON.stringify(this.launchArguments), 'utf8').toString('base64url')
        )
      }
    }
    const result = await this.run('powershell.exe', args, {
      timeout: 20_000,
      windowsHide: true,
      encoding: 'utf8'
    })
    const lines = result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
    const raw = lines.at(-1)
    if (!raw) {
      throw new Error(
        `Relais Windows sans réponse${result.stderr ? `: ${result.stderr.trim()}` : ''}`
      )
    }
    let parsed: RelayState
    try {
      parsed = JSON.parse(raw) as RelayState
    } catch {
      throw new Error(`Réponse du relais Windows invalide: ${raw.slice(0, 300)}`)
    }
    if (
      parsed.available !== true ||
      parsed.wakeToRun !== true ||
      parsed.startWhenAvailable !== false ||
      parsed.multipleInstances !== 'IgnoreNew'
    ) {
      throw new Error(`Contrat de réveil Windows non respecté: ${JSON.stringify(parsed)}`)
    }
    return parsed
  }
}

export function taskOccurrenceFromArgs(args: readonly string[]): string | undefined {
  const index = args.indexOf('--autowin-task-occurrence-b64')
  const encoded = index >= 0 ? args[index + 1] : undefined
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) return undefined
  try {
    const base64 = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')
    const decoded = Buffer.from(padded, 'base64').toString('utf8')
    return decoded.includes('@') ? decoded : undefined
  } catch {
    return undefined
  }
}

export function taskOccurrenceFromAdditionalData(data: unknown): string | undefined {
  if (!data || typeof data !== 'object') return undefined
  const occurrence = (data as { autowinTaskOccurrence?: unknown }).autowinTaskOccurrence
  return typeof occurrence === 'string' && /^.+@\d+$/.test(occurrence) ? occurrence : undefined
}
