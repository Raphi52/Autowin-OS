import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawnSync: vi.fn(() => ({ status: 0 })),
  brainServiceToken: vi.fn(() => 'brain-token'),
  loadTokens: vi.fn(() => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    obtainedAt: Date.now(),
    expiresInSec: undefined as number | undefined
  }))
}))

vi.mock('node:child_process', () => ({ spawnSync: mocks.spawnSync }))
vi.mock('./brain-retrieval', () => ({ brainServiceToken: mocks.brainServiceToken }))
vi.mock('./providers/codex-auth', () => ({ loadTokens: mocks.loadTokens }))

const originalFetch = globalThis.fetch

describe('runAppPreflight', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.spawnSync.mockClear()
    mocks.brainServiceToken.mockClear()
    mocks.loadTokens.mockClear()
    delete process.env.CODEX_BIN
    delete process.env.CLAUDE_BIN
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('partage le preflight en vol et force une nouvelle exécution à la demande', async () => {
    const { runAppPreflight } = await import('./preflight-probes')
    let releaseFetch!: () => void
    const fetchGate = new Promise<Response>((resolve) => {
      releaseFetch = () => resolve(new Response(null, { status: 200 }))
    })
    const fetchMock = vi.fn(() => fetchGate)
    globalThis.fetch = fetchMock as typeof fetch

    const options = { standbyProviders: ['kimi'] as const }
    const first = runAppPreflight(false, { standbyProviders: [...options.standbyProviders] })
    const second = runAppPreflight(false, { standbyProviders: [...options.standbyProviders] })
    releaseFetch()

    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(secondResult).toBe(firstResult)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(mocks.spawnSync).toHaveBeenCalledTimes(2)
    expect(mocks.loadTokens).toHaveBeenCalledTimes(1)
    expect(mocks.brainServiceToken).toHaveBeenCalledTimes(1)

    await runAppPreflight(true, { standbyProviders: [...options.standbyProviders] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.spawnSync).toHaveBeenCalledTimes(4)
    expect(mocks.loadTokens).toHaveBeenCalledTimes(2)
    expect(mocks.brainServiceToken).toHaveBeenCalledTimes(2)
  })

  it('probe réellement le CLI Kimi lorsqu’il est explicitement actif', async () => {
    const { appPreflightProbes } = await import('./preflight-probes')

    expect(await appPreflightProbes().hasBin('kimi')).toBe(true)
    expect(mocks.spawnSync).toHaveBeenCalledWith(
      'kimi',
      ['--version'],
      expect.objectContaining({ timeout: 3000 })
    )
  })

  it('refuse une session Codex dont l’expiration est dépassée', async () => {
    mocks.loadTokens.mockReturnValueOnce({
      accessToken: 'expired-access',
      refreshToken: 'expired-refresh',
      obtainedAt: Date.now() - 2000,
      expiresInSec: 1
    })
    const { appPreflightProbes } = await import('./preflight-probes')

    expect(await appPreflightProbes().hasCodexSession()).toBe(false)
  })

  it('conserve le résultat forcé récent quand un run normal plus ancien finit ensuite', async () => {
    let rejectFirst!: (reason: Error) => void
    const slowFailure = new Promise<Response>((_resolve, reject) => {
      rejectFirst = reject
    })
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(() => slowFailure)
      .mockResolvedValueOnce(new Response(null, { status: 200 }))
    globalThis.fetch = fetchMock as typeof fetch
    const { getLastAppPreflightResult, runAppPreflight } = await import('./preflight-probes')

    const olderNormal = runAppPreflight(false)
    const newerForced = runAppPreflight(true)
    const forcedResult = await newerForced
    rejectFirst(new Error('ancien probe indisponible'))
    const normalResult = await olderNormal

    expect(forcedResult.checks.find((check) => check.id === 'brain')?.ok).toBe(true)
    expect(normalResult.checks.find((check) => check.id === 'brain')?.ok).toBe(false)
    expect(getLastAppPreflightResult()).toBe(forcedResult)
    expect(await runAppPreflight(false)).toBe(forcedResult)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
