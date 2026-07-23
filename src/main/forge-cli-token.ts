import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { TicketSourceProfile } from '../shared/tickets'
import { parseTicketCredential } from './ticket-credential-store'
import type { TicketRuntimeCredential } from './tickets-service'

const execFileAsync = promisify(execFile)

export type ForgeCliRunner = (
  executable: 'gh' | 'glab',
  args: readonly string[]
) => Promise<{ stdout: string }>

const defaultRunner: ForgeCliRunner = async (executable, args) => {
  const windows = process.platform === 'win32'
  const target = windows ? (process.env.ComSpec ?? 'cmd.exe') : executable
  const targetArgs = windows ? ['/d', '/s', '/c', executable, ...args] : [...args]
  const result = await execFileAsync(target, targetArgs, {
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 16_384
  })
  return { stdout: result.stdout }
}

function environmentToken(
  source: TicketSourceProfile,
  environment: Readonly<Record<string, string | undefined>>
): string | undefined {
  if (source.provider === 'github') return environment.GH_TOKEN ?? environment.GITHUB_TOKEN
  if (source.provider === 'gitlab') return environment.GITLAB_TOKEN ?? environment.GLAB_TOKEN
  return undefined
}

export async function loadForgeCliToken(
  source: TicketSourceProfile,
  runner: ForgeCliRunner = defaultRunner,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<TicketRuntimeCredential | null> {
  if (source.provider === 'azure') return null
  const configured = environmentToken(source, environment)
  if (configured) {
    return { token: parseTicketCredential(configured), authScheme: 'bearer' }
  }
  const executable = source.provider === 'github' ? 'gh' : 'glab'
  try {
    const result = await runner(executable, ['auth', 'token'])
    return { token: parseTicketCredential(result.stdout.trim()), authScheme: 'bearer' }
  } catch {
    return null
  }
}
