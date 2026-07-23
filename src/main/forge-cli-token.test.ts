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
    expect(runner).toHaveBeenNthCalledWith(1, 'gh', ['auth', 'token', '--hostname', 'github.com'])
    expect(runner).toHaveBeenNthCalledWith(2, 'glab', [
      'config',
      'get',
      'token',
      '--host',
      'gitlab.com',
      '--global'
    ])
  })

  it('ne transmet jamais un token public global à un hôte personnalisé', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('hôte non authentifié'))
    await expect(
      loadForgeCliToken({ ...github, apiBaseUrl: 'https://attacker.example/api/v3' }, runner, {
        GH_TOKEN: 'github-public-secret'
      })
    ).resolves.toBeNull()
    await expect(
      loadForgeCliToken({ ...gitlab, baseUrl: 'https://attacker.example' }, runner, {
        GITLAB_TOKEN: 'gitlab-public-secret'
      })
    ).resolves.toBeNull()
    expect(runner).toHaveBeenNthCalledWith(1, 'gh', [
      'auth',
      'token',
      '--hostname',
      'attacker.example'
    ])
    expect(runner).toHaveBeenNthCalledWith(2, 'glab', [
      'config',
      'get',
      'token',
      '--host',
      'attacker.example',
      '--global'
    ])
  })

  it('n’accepte un token entreprise que si son hôte est explicitement lié', async () => {
    const runner = vi.fn()
    await expect(
      loadForgeCliToken({ ...github, apiBaseUrl: 'https://github.corp.example/api/v3' }, runner, {
        GH_HOST: 'github.corp.example',
        GH_ENTERPRISE_TOKEN: 'github-enterprise-secret'
      })
    ).resolves.toMatchObject({ token: 'github-enterprise-secret' })
    await expect(
      loadForgeCliToken({ ...gitlab, baseUrl: 'https://gitlab.corp.example' }, runner, {
        GITLAB_HOST: 'gitlab.corp.example',
        GITLAB_TOKEN: 'gitlab-enterprise-secret'
      })
    ).resolves.toMatchObject({ token: 'gitlab-enterprise-secret' })
    expect(runner).not.toHaveBeenCalled()
  })

  it('ne renvoie jamais un token entreprise vers la forge publique', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('hôte public non authentifié'))
    await expect(
      loadForgeCliToken(github, runner, {
        GH_HOST: 'github.corp.example',
        GH_TOKEN: 'github-enterprise-secret'
      })
    ).resolves.toBeNull()
    await expect(
      loadForgeCliToken(gitlab, runner, {
        GITLAB_HOST: 'gitlab.corp.example',
        GITLAB_TOKEN: 'gitlab-enterprise-secret'
      })
    ).resolves.toBeNull()
    expect(runner).toHaveBeenNthCalledWith(1, 'gh', [
      'auth',
      'token',
      '--hostname',
      'github.com'
    ])
    expect(runner).toHaveBeenNthCalledWith(2, 'glab', [
      'config',
      'get',
      'token',
      '--host',
      'gitlab.com',
      '--global'
    ])
  })

  it('échoue fermé quand la liaison d’hôte est invalide', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('hôte public non authentifié'))
    await expect(
      loadForgeCliToken(github, runner, {
        GH_HOST: 'not a valid host',
        GH_TOKEN: 'github-unbound-secret'
      })
    ).resolves.toBeNull()
    await expect(
      loadForgeCliToken(gitlab, runner, {
        GITLAB_HOST: 'not a valid host',
        GITLAB_TOKEN: 'gitlab-unbound-secret'
      })
    ).resolves.toBeNull()
    expect(runner).toHaveBeenCalledTimes(2)
  })

  it('considère deux ports du même hostname comme deux cibles distinctes', async () => {
    const runner = vi.fn().mockRejectedValue(new Error('origin non authentifié'))
    await expect(
      loadForgeCliToken(
        { ...github, apiBaseUrl: 'https://github.corp.example:8443/api/v3' },
        runner,
        {
          GH_HOST: 'github.corp.example',
          GH_ENTERPRISE_TOKEN: 'credential-for-default-port'
        }
      )
    ).resolves.toBeNull()
    await expect(
      loadForgeCliToken({ ...gitlab, baseUrl: 'https://gitlab.corp.example:8443' }, runner, {
        GITLAB_HOST: 'gitlab.corp.example',
        GITLAB_TOKEN: 'credential-for-default-port'
      })
    ).resolves.toBeNull()
    expect(runner).toHaveBeenNthCalledWith(1, 'gh', [
      'auth',
      'token',
      '--hostname',
      'github.corp.example:8443'
    ])
    expect(runner).toHaveBeenNthCalledWith(2, 'glab', [
      'config',
      'get',
      'token',
      '--host',
      'gitlab.corp.example:8443',
      '--global'
    ])
  })
})
