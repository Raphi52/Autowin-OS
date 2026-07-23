import { describe, expect, it, vi } from 'vitest'
import { TicketProviderError, fetchTicketJson } from './provider-contract'

describe('frontière HTTP des fournisseurs Tickets', () => {
  it('effectue uniquement une lecture HTTPS avec timeout et limite de réponse', async () => {
    const fetchFn = vi.fn(async () =>
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

  it('autorise le POST de lecture requis pour une requête WIQL', async () => {
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
  ])('refuse une origine non sûre %s', async (url, code) => {
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

  it('rejette une réponse trop volumineuse avant parsing', async () => {
    const fetchFn = vi.fn(async () =>
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
})
