import { describe, expect, it } from 'vitest'
import { cliChildEnvironment } from './cli-child-environment'

describe('environnement minimal des CLI externes', () => {
  it('conserve seulement le runtime, les configs CLI et le transport réseau', () => {
    expect(
      cliChildEnvironment({
        PATH: 'bin',
        SystemRoot: 'C:\\Windows',
        USERPROFILE: 'C:\\Users\\test',
        GH_CONFIG_DIR: 'C:\\config\\gh',
        AZURE_CONFIG_DIR: 'C:\\config\\azure',
        HTTPS_PROXY: 'https://proxy.example',
        NODE_EXTRA_CA_CERTS: 'C:\\certs\\corp.pem',
        UNRELATED_SETTING: 'drop'
      })
    ).toEqual({
      PATH: 'bin',
      SystemRoot: 'C:\\Windows',
      USERPROFILE: 'C:\\Users\\test',
      GH_CONFIG_DIR: 'C:\\config\\gh',
      AZURE_CONFIG_DIR: 'C:\\config\\azure',
      HTTPS_PROXY: 'https://proxy.example',
      NODE_EXTRA_CA_CERTS: 'C:\\certs\\corp.pem'
    })
  })

  it('retire tous les secrets connus, y compris avec une casse Windows mixte', () => {
    expect(
      cliChildEnvironment({
        PATH: 'bin',
        AZURE_DEVOPS_EXT_PAT: 'azure-secret',
        OPENAI_API_KEY: 'openai-secret',
        ANTHROPIC_API_KEY: 'anthropic-secret',
        Gh_ToKeN: 'github-secret',
        gItLaB_tOkEn: 'gitlab-secret',
        AMITEL_BRAIN_TOKEN: 'brain-secret',
        AWS_SECRET_ACCESS_KEY: 'aws-secret'
      })
    ).toEqual({ PATH: 'bin' })
  })
})
