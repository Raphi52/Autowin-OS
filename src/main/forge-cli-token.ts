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
  if (source.provider === 'github') {
    if (!source.apiBaseUrl) return environment.GH_TOKEN ?? environment.GITHUB_TOKEN
    if (environment.GH_HOST === new URL(source.apiBaseUrl).hostname) {
      return environment.GH_ENTERPRISE_TOKEN ?? environment.GITHUB_ENTERPRISE_TOKEN
    }
  }
  if (source.provider === 'gitlab') {
    if (!source.baseUrl) return environment.GITLAB_TOKEN ?? environment.GLAB_TOKEN
    if (environment.GITLAB_HOST === new URL(source.baseUrl).hostname) {
      return environment.GITLAB_TOKEN ?? environment.GLAB_TOKEN
    }
  }
  return undefined
}

function providerHost(source: TicketSourceProfile): string {
  if (source.provider === 'github') {
    return source.apiBaseUrl ? new URL(source.apiBaseUrl).hostname : 'github.com'
  }
  if (source.provider === 'gitlab') {
    return source.baseUrl ? new URL(source.baseUrl).hostname : 'gitlab.com'
  }
  throw new Error('Source forge requise')
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
  const hostname = providerHost(source)
  const args =
    source.provider === 'github'
      ? ['auth', 'token', '--hostname', hostname]
      : ['config', 'get', 'token', '--host', hostname, '--global']
  try {
    const result = await runner(executable, args)
    return { token: parseTicketCredential(result.stdout.trim()), authScheme: 'bearer' }
  } catch {
    return null
  }
}
