import { describe, expect, it, vi } from 'vitest'
import type { GitLabTicketSource } from '../../shared/tickets'
import { TicketProviderError } from './provider-contract'
import { gitlabTicketProvider } from './gitlab'

const source: GitLabTicketSource = {
  id: 'gitlab:group/subgroup:project',
  label: 'group/subgroup/project',
  provider: 'gitlab',
  namespace: 'group/subgroup',
  repository: 'project'
}

describe('adaptateur GitLab Issues', () => {
  it('lit toutes les issues, encode le projet, borne la page et suit x-next-page', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json(
        [
          {
            id: 9001,
            iid: 42,
            project_id: 17,
            title: 'Keep every work item',
            state: 'opened',
            issue_type: 'issue',
            web_url: 'https://gitlab.com/group/subgroup/project/-/issues/42',
            created_at: '2026-07-20T08:00:00Z',
            updated_at: '2026-07-23T09:30:00Z',
            description: 'Issue body',
            assignees: [{ username: 'gitlab-user' }],
            labels: ['bug', 'priority::high'],
            milestone: { title: 'v2' }
          }
        ],
        { headers: { 'x-next-page': '3' } }
      )
    )

    await expect(
      gitlabTicketProvider.list(
        { source, cursor: '2', pageSize: 500 },
        { token: 'gitlab-secret', fetchFn: fetchFn as typeof fetch }
      )
    ).resolves.toEqual({
      items: [
        {
          id: '42',
          sourceId: source.id,
          type: 'Issue',
          title: 'Keep every work item',
          state: 'opened',
          assignee: 'gitlab-user',
          priority: 'high',
          createdAt: '2026-07-20T08:00:00Z',
          updatedAt: '2026-07-23T09:30:00Z',
          description: 'Issue body',
          url: 'https://gitlab.com/group/subgroup/project/-/issues/42',
          fields: {
            databaseId: 9001,
            projectId: 17,
            labels: ['bug', 'priority::high'],
            milestone: 'v2'
          }
        }
      ],
      cursor: '3',
      hasMore: true
    })

    const [url, init] = fetchFn.mock.calls[0]
    expect(url).toBe(
      'https://gitlab.com/api/v4/projects/group%2Fsubgroup%2Fproject/issues?scope=all&state=all&per_page=100&page=2'
    )
    expect(init).toEqual(
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({
          accept: 'application/json',
          authorization: 'Bearer gitlab-secret'
        })
      })
    )
  })

  it('utilise la base configurée, la borne basse et termine sans page suivante', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json([])
    )

    await expect(
      gitlabTicketProvider.list(
        {
          source: { ...source, baseUrl: 'https://gitlab.example.test/' },
          pageSize: 0
        },
        { token: '', fetchFn: fetchFn as typeof fetch }
      )
    ).resolves.toEqual({ items: [], hasMore: false })

    expect(fetchFn.mock.calls[0][0]).toBe(
      'https://gitlab.example.test/api/v4/projects/group%2Fsubgroup%2Fproject/issues?scope=all&state=all&per_page=1&page=1'
    )
    expect(fetchFn.mock.calls[0][1]?.headers).not.toHaveProperty('authorization')
  })

  it('rejette une charge utile qui ne contient pas une liste', async () => {
    const fetchFn = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) =>
      Response.json({ message: 'unexpected' })
    )

    await expect(
      gitlabTicketProvider.list({ source }, { token: 'secret', fetchFn: fetchFn as typeof fetch })
    ).rejects.toEqual(new TicketProviderError('INVALID_RESPONSE', 'Réponse GitLab invalide.'))
  })
})
