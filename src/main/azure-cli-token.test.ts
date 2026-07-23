import { describe, expect, it, vi } from 'vitest'
import { loadAzureDevOpsCliToken } from './azure-cli-token'

describe('credential Azure DevOps via Azure CLI', () => {
  it('demande le resource id Azure DevOps et ne retourne que le token', async () => {
    const run = vi.fn(async () => ({ stdout: 'token-secret\n', stderr: '' }))

    await expect(loadAzureDevOpsCliToken(run)).resolves.toBe('token-secret')
    expect(run).toHaveBeenCalledWith('az.cmd', [
      'account',
      'get-access-token',
      '--resource',
      '499b84ac-1321-427f-aa17-267ca6975798',
      '--query',
      'accessToken',
      '-o',
      'tsv'
    ])
  })

  it('échoue sans recopier une sortie CLI sensible', async () => {
    const run = vi.fn(async () => {
      throw new Error('token-secret')
    })

    await expect(loadAzureDevOpsCliToken(run)).rejects.toThrow(
      'Session Azure CLI indisponible.'
    )
  })
})
