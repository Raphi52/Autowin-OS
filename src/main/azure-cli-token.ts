import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseTicketCredential } from './ticket-credential-store'

const execFileAsync = promisify(execFile)
const AZURE_DEVOPS_RESOURCE_ID = '499b84ac-1321-427f-aa17-267ca6975798'

export type AzureCliRunner = (
  executable: string,
  args: string[]
) => Promise<{ stdout: string; stderr: string }>

const defaultRunner: AzureCliRunner = async (executable, args) => {
  const result = await execFileAsync(executable, args, {
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 16_384,
    encoding: 'utf8'
  })
  return { stdout: result.stdout, stderr: result.stderr }
}

export async function loadAzureDevOpsCliToken(
  run: AzureCliRunner = defaultRunner
): Promise<string> {
  try {
    const result = await run('az.cmd', [
      'account',
      'get-access-token',
      '--resource',
      AZURE_DEVOPS_RESOURCE_ID,
      '--query',
      'accessToken',
      '-o',
      'tsv'
    ])
    return parseTicketCredential(result.stdout.trim())
  } catch {
    throw new Error('Session Azure CLI indisponible.')
  }
}
