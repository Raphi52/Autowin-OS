import { describe, expect, it, vi } from 'vitest'
import { TicketProviderError, fetchTicketJson } from './provider-contract'

describe('fronti?re HTTP des fournisseurs Tickets', () => {
  it('effectue uniquement une lecture HTTPS avec timeout et limite de r?ponse', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        })
    )

    await expect(
      fetchTicketJson<{ ok: boolean }>('https://example.test/items', {
        fetchFn: fetchFn as typeof fetch,
        headers: { authorization: 'Bearer secret' }
      })
    ).resolves.toEqual({ ok: true })
    expect(fetchFn).toHaveBeenCalledWith(
      'https://example.test/items',
      expect.objectContaining({ method: 'GET', signal: expect.any(AbortSignal) })
    )
  })

  it('autorise le POST de lecture requis pour une requ?te WIQL', async () => {
    const fetchFn = vi.fn(async () => Response.json({ workItems: [] }))

    await fetchTicketJson('https://dev.azure.com/org/project/_apis/wit/wiql', {
      fetchFn: fetchFn as typeof fetch,
      method: 'POST',
      body: { query: 'SELECT [System.Id] FROM WorkItems' }
    })

    expect(fetchFn).toHaveBeenCalledWith(
      'https://dev.azure.com/org/project/_apis/wit/wiql',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ query: 'SELECT [System.Id] FROM WorkItems' }),
        headers: expect.objectContaining({ 'content-type': 'application/json' })
      })
    )
  })

  it.each([
    ['http://example.test/items', 'UNSAFE_URL'],
    ['https://user:secret@example.test/items', 'UNSAFE_URL']
  ])('refuse une origine non s?re %s', async (url, code) => {
    await expect(fetchTicketJson(url, { fetchFn: vi.fn() as typeof fetch })).rejects.toMatchObject({
      code
    })
  })

  it('classe les erreurs sans recopier le corps ni le token', async () => {
    const fetchFn = vi.fn(async () => new Response('token-secret serveur', { status: 401 }))

    await expect(
      fetchTicketJson('https://example.test/items', {
        fetchFn: fetchFn as typeof fetch,
        headers: { authorization: 'Bearer token-secret' }
      })
    ).rejects.toEqual(new TicketProviderError('AUTH_REQUIRED', 'Authentification requise.'))
  })

  it.each([
    [403, 'ACCESS_DENIED', 'Acc?s refus?.'],
    [429, 'RATE_LIMITED', 'Limite fournisseur atteinte.'],
    [502, 'REMOTE_ERROR', 'Le fournisseur a r?pondu avec le statut 502.']
  ])('distingue le statut HTTP %i', async (status, code, message) => {
    const fetchFn = vi.fn(async () => new Response('d?tail serveur priv?', { status }))

    await expect(
      fetchTicketJson('https://example.test/items', { fetchFn: fetchFn as typeof fetch })
    ).rejects.toMatchObject({ code, message })
  })

  it('rejette une r?ponse trop volumineuse avant parsing', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ value: 'x'.repeat(200) }), {
          headers: { 'content-length': '212' }
        })
    )

    await expect(
      fetchTicketJson('https://example.test/items', {
        fetchFn: fetchFn as typeof fetch,
        maxBytes: 100
      })
    ).rejects.toMatchObject({ code: 'RESPONSE_TOO_LARGE' })
  })

  it('distingue un timeout d?une panne r?seau et propage une annulation externe', async () => {
    const never = vi.fn(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
        })
    ) as typeof fetch
    await expect(
      fetchTicketJson('https://example.test/items', { fetchFn: never, timeoutMs: 1 })
    ).rejects.toMatchObject({ code: 'TIMEOUT' })

    const controller = new AbortController()
    const pending = fetchTicketJson('https://example.test/items', {
      fetchFn: never,
      signal: controller.signal
    })
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'ABORTED' })
  })
})
