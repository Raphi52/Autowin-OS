import { describe, expect, it, vi } from 'vitest'
import type { GitHubTicketSource, GitLabTicketSource } from '../shared/tickets'
import { loadForgeCliToken } from './forge-cli-token'

const github: GitHubTicketSource = {
  id: 'github:private:repo',
  label: 'private / repo',
  provider: 'github',
  owner: 'private',
  repository: 'repo'
}
const gitlab: GitLabTicketSource = {
  id: 'gitlab:private:repo',
  label: 'private / repo',
  provider: 'gitlab',
  namespace: 'private',
  repository: 'repo'
}

describe('credentials runtime des forges', () => {
  it('préfère les variables main-only sans exposer le token', async () => {
    const runner = vi.fn()
    await expect(loadForgeCliToken(github, runner, { GH_TOKEN: 'gh-secret' })).resolves.toEqual({
      token: 'gh-secret',
      authScheme: 'bearer'
    })
    await expect(loadForgeCliToken(gitlab, runner, { GITLAB_TOKEN: 'gl-secret' })).resolves.toEqual(
      { token: 'gl-secret', authScheme: 'bearer' }
    )
    expect(runner).not.toHaveBeenCalled()
  })

  it('utilise les sessions CLI GitHub et GitLab, puis dégrade en accès public', async () => {
    const runner = vi
      .fn()
      .mockResolvedValueOnce({ stdout: 'gh-cli-secret\n' })
      .mockResolvedValueOnce({ stdout: 'glab-cli-secret\n' })
      .mockRejectedValueOnce(new Error('not logged in'))
    await expect(loadForgeCliToken(github, runner, {})).resolves.toMatchObject({
      token: 'gh-cli-secret'
    })
    await expect(loadForgeCliToken(gitlab, runner, {})).resolves.toMatchObject({
      token: 'glab-cli-secret'
    })
    await expect(loadForgeCliToken(github, runner, {})).resolves.toBeNull()
    expect(runner).toHaveBeenNthCalledWith(1, 'gh', ['auth', 'token'])
    expect(runner).toHaveBeenNthCalledWith(2, 'glab', ['auth', 'token'])
  })
})
