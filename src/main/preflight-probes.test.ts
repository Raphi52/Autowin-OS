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

  it('ne réutilise pas un cache calculé pour une autre configuration standby', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch
    const { runAppPreflight } = await import('./preflight-probes')

    await runAppPreflight(false, { standbyProviders: ['kimi'] })
    expect(mocks.spawnSync).toHaveBeenCalledTimes(2)

    await runAppPreflight(false, { standbyProviders: [] })
    expect(mocks.spawnSync).toHaveBeenCalledTimes(5)
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

  it('re-sonde avec backoff tant que brain échoue puis s’arrête à la récupération', async () => {
    const { watchAppPreflight } = await import('./preflight-probes')
    type R = import('./preflight').PreflightResult
    const brainKo: R = { ok: false, summary: '', checks: [{ id: 'brain', label: 'b', ok: false }] }
    const allOk: R = { ok: true, summary: '', checks: [{ id: 'brain', label: 'b', ok: true }] }
    const results = [brainKo, brainKo, allOk]
    const run = vi.fn(async () => results.shift() ?? allOk)
    const queue: Array<() => void> = []
    const schedule = (fn: () => void): { cancel: () => void } => {
      queue.push(fn)
      return { cancel: () => {} }
    }
    const flush = async (): Promise<void> => {
      while (queue.length) {
        queue.shift()!()
        for (let i = 0; i < 4; i++) await Promise.resolve()
      }
    }
    const seen: R[] = []
    watchAppPreflight((r) => seen.push(r), { delaysMs: [10, 10, 10, 10] }, { run, schedule })
    for (let i = 0; i < 4; i++) await Promise.resolve()

    expect(run).toHaveBeenCalledTimes(1)
    expect(run).toHaveBeenNthCalledWith(1, false, expect.anything()) // 1ᵉʳ tour respecte le cache
    await flush()

    expect(run).toHaveBeenCalledTimes(3) // 2 échecs + 1 récupération
    expect(run).toHaveBeenNthCalledWith(2, true, expect.anything()) // re-probes en force
    expect(seen).toHaveLength(3)
    expect(seen[2].ok).toBe(true)
    expect(queue).toHaveLength(0) // arrêt net sur ok, aucun re-probe de trop
  })

  it('borne la boucle au cap de backoff si brain reste KO', async () => {
    const { watchAppPreflight } = await import('./preflight-probes')
    type R = import('./preflight').PreflightResult
    const brainKo: R = { ok: false, summary: '', checks: [{ id: 'brain', label: 'b', ok: false }] }
    const run = vi.fn(async () => brainKo)
    const queue: Array<() => void> = []
    const schedule = (fn: () => void): { cancel: () => void } => {
      queue.push(fn)
      return { cancel: () => {} }
    }
    const flush = async (): Promise<void> => {
      while (queue.length) {
        queue.shift()!()
        for (let i = 0; i < 4; i++) await Promise.resolve()
      }
    }
    watchAppPreflight(() => {}, { delaysMs: [10, 10] }, { run, schedule })
    for (let i = 0; i < 4; i++) await Promise.resolve()
    await flush()
    // 1 tour initial + 2 re-probes (cap = delays.length) = 3, puis STOP.
    expect(run).toHaveBeenCalledTimes(3)
    expect(queue).toHaveLength(0)
  })

  it('ne s’acharne pas si le seul échec est non-récupérable (CLI/token, pas brain)', async () => {
    const { watchAppPreflight } = await import('./preflight-probes')
    type R = import('./preflight').PreflightResult
    const brainOkCodexKo: R = {
      ok: false,
      summary: '',
      checks: [
        { id: 'brain', label: 'b', ok: true },
        { id: 'codex', label: 'c', ok: false }
      ]
    }
    const run = vi.fn(async () => brainOkCodexKo)
    const queue: Array<() => void> = []
    const schedule = (fn: () => void): { cancel: () => void } => {
      queue.push(fn)
      return { cancel: () => {} }
    }
    watchAppPreflight(() => {}, { delaysMs: [10, 10] }, { run, schedule })
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1) // brain ok → aucun re-probe, même si codex KO
    expect(queue).toHaveLength(0)
  })

  it('stop() coupe la boucle en vol (pas de re-probe après arrêt)', async () => {
    const { watchAppPreflight } = await import('./preflight-probes')
    type R = import('./preflight').PreflightResult
    const brainKo: R = { ok: false, summary: '', checks: [{ id: 'brain', label: 'b', ok: false }] }
    const run = vi.fn(async () => brainKo)
    const queue: Array<() => void> = []
    let cancelled = 0
    const schedule = (fn: () => void): { cancel: () => void } => {
      queue.push(fn)
      return { cancel: () => cancelled++ }
    }
    const handle = watchAppPreflight(() => {}, { delaysMs: [10, 10] }, { run, schedule })
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1)
    expect(queue).toHaveLength(1) // un re-probe planifié
    handle.stop()
    queue.shift()!() // même si le timer « tire », la boucle est stoppée
    for (let i = 0; i < 4; i++) await Promise.resolve()
    expect(run).toHaveBeenCalledTimes(1) // aucun re-probe après stop
    expect(cancelled).toBe(1)
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
