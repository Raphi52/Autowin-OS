import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(() => {
    const child = {
      kill: vi.fn(),
      on: vi.fn((event: string, listener: (code: number) => void) => {
        if (event === 'close') setTimeout(() => listener(0), 0)
        return child
      }),
      once: vi.fn((event: string, listener: (code: number) => void) => {
        if (event === 'close') setTimeout(() => listener(0), 0)
        return child
      })
    }
    return child
  }),
  brainServiceToken: vi.fn(() => 'brain-token'),
  loadTokens: vi.fn(() => ({
    accessToken: 'access',
    refreshToken: 'refresh',
    obtainedAt: Date.now(),
    expiresInSec: undefined as number | undefined
  }))
}))

vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('./brain-retrieval', () => ({ brainServiceToken: mocks.brainServiceToken }))
vi.mock('./providers/codex-auth', () => ({ loadTokens: mocks.loadTokens }))

const originalFetch = globalThis.fetch

describe('runAppPreflight', () => {
  beforeEach(() => {
    vi.resetModules()
    mocks.spawn.mockClear()
    mocks.brainServiceToken.mockClear()
    mocks.loadTokens.mockClear()
    delete process.env.CODEX_BIN
    delete process.env.CLAUDE_BIN
  })

  it('laisse respirer la boucle d’événements pendant un probe CLI', async () => {
    const { appPreflightProbes } = await import('./preflight-probes')
    let timerFired = false
    const timer = new Promise<'timer'>((resolve) => {
      setTimeout(() => {
        timerFired = true
        resolve('timer')
      }, 0)
    })

    const probe = appPreflightProbes()
      .hasBin('codex')
      .then(() => 'probe' as const)

    expect(await Promise.race([timer, probe])).toBe('timer')
    expect(timerFired).toBe(true)
    expect(await probe).toBe('probe')
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
    // 3 spawns : `codex --version`, `claude --version`, `claude auth status` (kimi en standby).
    expect(mocks.spawn).toHaveBeenCalledTimes(3)
    expect(mocks.loadTokens).toHaveBeenCalledTimes(1)
    expect(mocks.brainServiceToken).toHaveBeenCalledTimes(1)

    await runAppPreflight(true, { standbyProviders: [...options.standbyProviders] })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(mocks.spawn).toHaveBeenCalledTimes(6)
    expect(mocks.loadTokens).toHaveBeenCalledTimes(2)
    expect(mocks.brainServiceToken).toHaveBeenCalledTimes(2)
  })

  it('probe réellement le CLI Kimi lorsqu’il est explicitement actif', async () => {
    const { appPreflightProbes } = await import('./preflight-probes')

    expect(await appPreflightProbes().hasBin('kimi')).toBe(true)
    expect(mocks.spawn).toHaveBeenCalledWith(
      'kimi',
      ['--version'],
      expect.objectContaining({ windowsHide: true })
    )
  })

  it('ne réutilise pas un cache calculé pour une autre configuration standby', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as typeof fetch
    const { runAppPreflight } = await import('./preflight-probes')

    await runAppPreflight(false, { standbyProviders: ['kimi'] })
    // codex + claude (--version) + `claude auth status`
    expect(mocks.spawn).toHaveBeenCalledTimes(3)

    await runAppPreflight(false, { standbyProviders: [] })
    // + codex, claude, kimi (--version) + `claude auth status`
    expect(mocks.spawn).toHaveBeenCalledTimes(7)
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

  /**
   * DEFAUT VECU (conv-8, 2026-09-03) : ce ping visait `127.0.0.1:8765` ECRIT EN DUR alors que le
   * service a jour ecoutait 8766. La sonde declarait donc le cerveau eteint en permanence, et l'app
   * relancait des serveurs qui n'y servaient personne — pendant que la lecture du savoir, elle,
   * fonctionnait par l'origine CONFIGUREE. Meme defaut que celui corrige la veille dans
   * `brain-retrieval` : deux chemins vers le meme service, un seul qui lisait la configuration.
   *
   * ENTREE QUI FAIT ECHOUER CE TEST SI LA CORRECTION EST FAUSSE : une origine configuree sur un
   * AUTRE port que 8765. Une adresse en dur appelle 8765 et l'assertion tombe.
   */
  it('sonde l’origine CONFIGUREE, jamais une adresse ecrite en dur', async () => {
    process.env.AMITEL_BRAIN_ORIGIN = 'http://127.0.0.1:8790'
    // Le mock DECLARE son argument : sans lui, `mock.calls` est un tuple vide et l'URL sondee
    // — la seule chose que ce test verifie — serait inaccessible au controle de types.
    const fetchMock = vi.fn(async (_entree: unknown) => new Response('ok'))
    globalThis.fetch = fetchMock as unknown as typeof fetch
    try {
      const { appPreflightProbes } = await import('./preflight-probes')
      expect(await appPreflightProbes().pingBrain()).toBe(true)
      expect(String(fetchMock.mock.calls[0]?.[0])).toBe('http://127.0.0.1:8790/')
    } finally {
      globalThis.fetch = originalFetch
      delete process.env.AMITEL_BRAIN_ORIGIN
    }
  })
})
