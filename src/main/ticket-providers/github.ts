import type { GitHubTicketSource, TicketItem, TicketPage } from '../../shared/tickets'
import {
  TicketProviderError,
  fetchTicketJson,
  type TicketProviderAdapter,
  type TicketProviderContext
} from './provider-contract'

interface GitHubLabel {
  name?: unknown
}

interface GitHubIssue {
  id?: unknown
  number?: unknown
  title?: unknown
  state?: unknown
  html_url?: unknown
  created_at?: unknown
  updated_at?: unknown
  body?: unknown
  assignee?: { login?: unknown } | null
  labels?: unknown
  milestone?: { title?: unknown } | null
  pull_request?: unknown
}

interface GitHubSearchResponse {
  total_count?: unknown
  items?: unknown
}

function boundedInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number
): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(minimum, Math.trunc(value as number)))
}

function cursorPage(cursor: string | undefined): number {
  if (!cursor || !/^[1-9]\d*$/.test(cursor)) return 1
  return boundedInteger(Number(cursor), 1, 1, Number.MAX_SAFE_INTEGER)
}

function nextPage(linkHeader: string | null): string | undefined {
  if (!linkHeader) return undefined
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?next"?/i)
    if (!match) continue
    try {
      const page = new URL(match[1]).searchParams.get('page')
      if (page && /^[1-9]\d*$/.test(page)) return page
    } catch {
      return undefined
    }
  }
  return undefined
}

function labelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) return []
  return labels.flatMap((label) => {
    if (typeof label === 'string') return [label]
    if (
      typeof label === 'object' &&
      label !== null &&
      typeof (label as GitHubLabel).name === 'string'
    ) {
      return [(label as { name: string }).name]
    }
    return []
  })
}

function priorityFrom(labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const prefixed = label.match(/^priority\s*[:/-]\s*(.+)$/i)
    if (prefixed?.[1]) return prefixed[1].trim()
    if (/^p[0-4]$/i.test(label)) return label
  }
  return undefined
}

function isIssue(value: GitHubIssue): value is GitHubIssue & {
  id: number
  number: number
  title: string
  state: string
  html_url: string
  updated_at: string
} {
  return (
    typeof value.id === 'number' &&
    typeof value.number === 'number' &&
    typeof value.title === 'string' &&
    typeof value.state === 'string' &&
    typeof value.html_url === 'string' &&
    typeof value.updated_at === 'string'
  )
}

function normalizeIssue(issue: GitHubIssue, source: GitHubTicketSource): TicketItem {
  if (!isIssue(issue)) {
    throw new TicketProviderError('INVALID_RESPONSE', 'Réponse GitHub invalide.')
  }
  const labels = labelNames(issue.labels)
  const assignee =
    issue.assignee && typeof issue.assignee.login === 'string' ? issue.assignee.login : undefined
  const milestone =
    issue.milestone && typeof issue.milestone.title === 'string' ? issue.milestone.title : undefined

  return {
    id: String(issue.number),
    sourceId: source.id,
    type: 'Issue',
    title: issue.title,
    state: issue.state,
    url: issue.html_url,
    updatedAt: issue.updated_at,
    ...(typeof issue.created_at === 'string' ? { createdAt: issue.created_at } : {}),
    ...(assignee ? { assignee } : {}),
    ...(priorityFrom(labels) ? { priority: priorityFrom(labels) } : {}),
    ...(typeof issue.body === 'string' ? { description: issue.body } : {}),
    fields: {
      databaseId: issue.id,
      labels,
      ...(milestone ? { milestone } : {})
    }
  }
}

function issuesUrl(source: GitHubTicketSource, page: number, pageSize: number): string {
  const base = (source.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
  const url = new URL(
    `${base}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/issues`
  )
  url.searchParams.set('state', 'all')
  url.searchParams.set('per_page', String(pageSize))
  url.searchParams.set('page', String(page))
  return url.toString()
}

function searchIssuesUrl(
  source: GitHubTicketSource,
  query: string,
  page: number,
  pageSize: number
): string {
  const base = (source.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
  const url = new URL(`${base}/search/issues`)
  url.searchParams.set('q', `repo:${source.owner}/${source.repository} is:issue ${query} in:title`)
  url.searchParams.set('per_page', String(pageSize))
  url.searchParams.set('page', String(page))
  return url.toString()
}

function issueUrl(source: GitHubTicketSource, id: string, suffix = ''): string {
  const base = (source.apiBaseUrl ?? 'https://api.github.com').replace(/\/+$/, '')
  return `${base}/repos/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repository)}/issues/${id}${suffix}`
}

function githubHeaders(context: TicketProviderContext): Record<string, string> {
  return {
    accept: 'application/vnd.github+json',
    ...(context.token ? { authorization: `Bearer ${context.token}` } : {}),
    'x-github-api-version': '2022-11-28'
  }
}

function positiveIssueId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!/^[1-9]\d*$/.test(id)) {
    throw new TicketProviderError('INVALID_RESPONSE', 'Identifiant GitHub invalide.')
  }
  return id
}

async function listGitHubIssues(
  source: GitHubTicketSource,
  cursor: string | undefined,
  pageSize: number | undefined,
  titleContains: string | undefined,
  context: TicketProviderContext
): Promise<TicketPage> {
  let linkHeader: string | null = null
  const delegate = context.fetchFn ?? fetch
  const captureFetch: typeof fetch = async (input, init) => {
    const response = await delegate(input, init)
    linkHeader = response.headers.get('link')
    return response
  }
  const page = cursorPage(cursor)
  const size = boundedInteger(pageSize, 50, 1, 100)
  const query = titleContains?.trim() ?? ''
  const payload = await fetchTicketJson<unknown>(
    query ? searchIssuesUrl(source, query, page, size) : issuesUrl(source, page, size),
    {
      fetchFn: captureFetch,
      signal: context.signal,
      headers: {
        accept: 'application/vnd.github+json',
        ...(context.token ? { authorization: `Bearer ${context.token}` } : {}),
        'x-github-api-version': '2022-11-28'
      }
    }
  )
  const issues = query ? (payload as GitHubSearchResponse)?.items : payload
  if (!Array.isArray(issues)) {
    throw new TicketProviderError('INVALID_RESPONSE', 'Réponse GitHub invalide.')
  }

  const next = nextPage(linkHeader)
  return {
    items: (issues as GitHubIssue[])
      .filter((issue) => issue.pull_request === undefined)
      .map((issue) => normalizeIssue(issue, source)),
    ...(next ? { cursor: next } : {}),
    hasMore: next !== undefined
  }
}

export const githubTicketProvider: TicketProviderAdapter = {
  provider: 'github',
  list(request, context) {
    if (request.source.provider !== 'github') {
      throw new TicketProviderError('UNSUPPORTED_PROVIDER', 'Source GitHub requise.')
    }
    return listGitHubIssues(
      request.source,
      request.cursor,
      request.pageSize,
      request.titleContains,
      context
    )
  },
  async get(request, context) {
    if (request.source.provider !== 'github') {
      throw new TicketProviderError('UNSUPPORTED_PROVIDER', 'Source GitHub requise.')
    }
    const payload = await fetchTicketJson<GitHubIssue>(
      issueUrl(request.source, positiveIssueId(request.id)),
      {
        fetchFn: context.fetchFn,
        signal: context.signal,
        headers: githubHeaders(context)
      }
    )
    return normalizeIssue(payload, request.source)
  },
  async update(request, context) {
    if (request.source.provider !== 'github') {
      throw new TicketProviderError('UNSUPPORTED_PROVIDER', 'Source GitHub requise.')
    }
    const id = positiveIssueId(request.id)
    const body: Record<string, unknown> = {
      ...(request.state ? { state: request.state } : {}),
      ...(request.assignee ? { assignees: [request.assignee] } : {})
    }
    let updated: GitHubIssue | undefined
    if (Object.keys(body).length) {
      updated = await fetchTicketJson<GitHubIssue>(issueUrl(request.source, id), {
        fetchFn: context.fetchFn,
        signal: context.signal,
        method: 'PATCH',
        headers: githubHeaders(context),
        body
      })
    }
    if (request.comment) {
      await fetchTicketJson<unknown>(issueUrl(request.source, id, '/comments'), {
        fetchFn: context.fetchFn,
        signal: context.signal,
        method: 'POST',
        headers: githubHeaders(context),
        body: { body: request.comment }
      })
    }
    if (!updated) {
      updated = await fetchTicketJson<GitHubIssue>(issueUrl(request.source, id), {
        fetchFn: context.fetchFn,
        signal: context.signal,
        headers: githubHeaders(context)
      })
    }
    return normalizeIssue(updated, request.source)
  }
}
