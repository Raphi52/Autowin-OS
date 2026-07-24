import { describe, expect, it, vi } from 'vitest'
import type { GitHubTicketSource } from '../../shared/tickets'
import { TicketProviderError } from './provider-contract'
import { githubTicketProvider } from './github'

const source: GitHubTicketSource = {
  id: 'github:openai:codex',
  label: 'openai/codex',
  provider: 'github',
  owner: 'openai',
  repository: 'codex'
}

describe('adaptateur GitHub Issues', () => {
  it('lit toutes les issues, borne la page, exclut les pull requests et suit Link', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json(
        [
          {
            id: 9001,
            number: 42,
            title: 'Keep every work item',
            state: 'open',
            html_url: 'https://github.com/openai/codex/issues/42',
            created_at: '2026-07-20T08:00:00Z',
            updated_at: '2026-07-23T09:30:00Z',
            body: 'Issue body',
            assignee: { login: 'octocat' },
            labels: [{ name: 'bug' }, { name: 'priority: high' }],
            milestone: { title: 'v2' }
          },
          {
            id: 9002,
            number: 43,
            title: 'This is a pull request',
            state: 'closed',
            html_url: 'https://github.com/openai/codex/pull/43',
            created_at: '2026-07-20T08:00:00Z',
            updated_at: '2026-07-23T09:30:00Z',
            body: null,
            assignee: null,
            labels: [],
            pull_request: { url: 'https://api.github.com/repos/openai/codex/pulls/43' }
          }
        ],
        {
          headers: {
            link: '<https://api.github.com/repositories/1/issues?page=3>; rel="next", <https://api.github.com/repositories/1/issues?page=8>; rel="last"'
          }
        }
      )
    )

    await expect(
      githubTicketProvider.list(
        { source, cursor: '2', pageSize: 500 },
        { token: 'github-secret', fetchFn: fetchFn as typeof fetch }
      )
    ).resolves.toEqual({
      items: [
        {
          id: '42',
          sourceId: source.id,
          type: 'Issue',
          title: 'Keep every work item',
          state: 'open',
          assignee: 'octocat',
          priority: 'high',
          createdAt: '2026-07-20T08:00:00Z',
          updatedAt: '2026-07-23T09:30:00Z',
          description: 'Issue body',
          url: 'https://github.com/openai/codex/issues/42',
          fields: {
            databaseId: 9001,
            labels: ['bug', 'priority: high'],
            milestone: 'v2'
          }
        }
      ],
      cursor: '3',
      hasMore: true
    })

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(
      'https://api.github.com/repos/openai/codex/issues?state=all&per_page=100&page=2'
    )
    expect(init).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          accept: 'application/vnd.github+json',
          authorization: 'Bearer github-secret'
        })
      })
    )
  })

  it('utilise la base API configur?e et termine sans lien next', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json([])
    )

    await expect(
      githubTicketProvider.list(
        {
          source: { ...source, apiBaseUrl: 'https://github.example.test/api/v3/' },
          pageSize: 0
        },
        { token: '', fetchFn: fetchFn as typeof fetch }
      )
    ).resolves.toEqual({ items: [], hasMore: false })

    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://github.example.test/api/v3/repos/openai/codex/issues?state=all&per_page=1&page=1'
    )
    expect(fetchFn.mock.calls[0][1]?.headers).not.toHaveProperty('authorization')
  })

  it('rejette une charge utile qui ne contient pas une liste', async () => {
    const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
      Response.json({ message: 'unexpected' })
    )

    await expect(
      githubTicketProvider.list({ source }, { token: 'secret', fetchFn: fetchFn as typeof fetch })
    ).rejects.toEqual(new TicketProviderError('INVALID_RESPONSE', 'R?ponse GitHub invalide.'))
  })
})
