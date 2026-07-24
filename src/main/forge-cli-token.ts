import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { isSafeForgeHost, type TicketSourceProfile } from '../shared/tickets'
import { parseTicketCredential } from './ticket-credential-store'
import type { TicketRuntimeCredential } from './tickets-service'
import { cliChildEnvironment } from './cli-child-environment'

const execFileAsync = promisify(execFile)

export const forgeCliEnvironment = cliChildEnvironment

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
    maxBuffer: 16_384,
    env: forgeCliEnvironment()
  })
  return { stdout: result.stdout }
}

function environmentToken(
  source: TicketSourceProfile,
  environment: Readonly<Record<string, string | undefined>>
): string | undefined {
  if (source.provider === 'github') {
    if (!source.apiBaseUrl) {
      const hostBinding = environment.GH_HOST?.trim()
      if (!hostBinding || configuredHost(hostBinding) === providerHost(source)) {
        return environment.GH_TOKEN ?? environment.GITHUB_TOKEN
      }
      return undefined
    }
    if (configuredHost(environment.GH_HOST) === providerHost(source)) {
      return environment.GH_ENTERPRISE_TOKEN ?? environment.GITHUB_ENTERPRISE_TOKEN
    }
  }
  if (source.provider === 'gitlab') {
    if (!source.baseUrl) {
      const hostBinding = environment.GITLAB_HOST?.trim()
      if (!hostBinding || configuredHost(hostBinding) === providerHost(source)) {
        return environment.GITLAB_TOKEN ?? environment.GLAB_TOKEN
      }
      return undefined
    }
    if (configuredHost(environment.GITLAB_HOST) === providerHost(source)) {
      return environment.GITLAB_TOKEN ?? environment.GLAB_TOKEN
    }
  }
  return undefined
}

function configuredHost(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return new URL(value.includes('://') ? value : `https://${value}`).host
  } catch {
    return undefined
  }
}

function providerHost(source: TicketSourceProfile): string {
  let host: string
  if (source.provider === 'github') {
    host = source.apiBaseUrl ? new URL(source.apiBaseUrl).host : 'github.com'
  } else if (source.provider === 'gitlab') {
    host = source.baseUrl ? new URL(source.baseUrl).host : 'gitlab.com'
  } else {
    throw new Error('Source forge requise')
  }
  if (!isSafeForgeHost(host)) throw new Error('Hôte forge invalide')
  return host
}

export async function loadForgeCliToken(
  source: TicketSourceProfile,
  runner: ForgeCliRunner = defaultRunner,
  environment: Readonly<Record<string, string | undefined>> = process.env
): Promise<TicketRuntimeCredential | null> {
  if (source.provider === 'azure') return null
  try {
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
    const result = await runner(executable, args)
    return { token: parseTicketCredential(result.stdout.trim()), authScheme: 'bearer' }
  } catch {
    return null
  }
}
