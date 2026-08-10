import type { GitLabTicketSource, TicketItem } from '../../shared/tickets'
import {
  fetchTicketJson,
  TicketProviderError,
  type TicketProviderAdapter
} from './provider-contract'

function boundedInteger(value: number | undefined, fallback: number, maximum: number): number {
  if (value === undefined || !Number.isFinite(value)) return fallback
  return Math.min(maximum, Math.max(1, Math.trunc(value)))
}

function pageFromCursor(cursor: string | undefined): number {
  if (!cursor || !/^[1-9]\d*$/.test(cursor)) return 1
  return boundedInteger(Number(cursor), 1, Number.MAX_SAFE_INTEGER)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function priorityFromLabels(labels: readonly string[]): string | undefined {
  for (const label of labels) {
    const match = /^priority(?:::|:\s*|=)\s*(.+)$/i.exec(label)
    if (match?.[1]) return match[1].trim()
  }
  return undefined
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function issueType(value: unknown): string {
  const raw = optionalText(value)
  return raw ? `${raw[0].toUpperCase()}${raw.slice(1)}` : 'Issue'
}

function normalizeIssue(value: unknown, source: GitLabTicketSource): TicketItem {
  if (!isRecord(value)) {
    throw new TicketProviderError('INVALID_RESPONSE', 'Réponse GitLab invalide.')
  }

  const iid = typeof value.iid === 'number' ? value.iid : undefined
  const title = optionalText(value.title)
  const state = optionalText(value.state)
  const url = optionalText(value.web_url)
  const updatedAt = optionalText(value.updated_at)
  if (iid === undefined || !title || !state || !url || !updatedAt) {
    throw new TicketProviderError('INVALID_RESPONSE', 'Réponse GitLab invalide.')
  }

  const labels = Array.isArray(value.labels)
    ? value.labels.filter((label): label is string => typeof label === 'string')
    : []
  const assignees = Array.isArray(value.assignees) ? value.assignees : []
  const firstAssignee = assignees.find(isRecord)
  const legacyAssignee = isRecord(value.assignee) ? value.assignee : undefined
  const assignee =
    optionalText(firstAssignee?.username) ??
    optionalText(firstAssignee?.name) ??
    optionalText(legacyAssignee?.username) ??
    optionalText(legacyAssignee?.name)
  const milestone = isRecord(value.milestone) ? optionalText(value.milestone.title) : undefined
  const fields: Record<string, unknown> = {
    ...(typeof value.id === 'number' ? { databaseId: value.id } : {}),
    ...(typeof value.project_id === 'number' ? { projectId: value.project_id } : {}),
    labels,
    ...(milestone ? { milestone } : {})
  }

  return {
    id: String(iid),
    sourceId: source.id,
    type: issueType(value.issue_type),
    title,
    state,
    ...(assignee ? { assignee } : {}),
    ...(priorityFromLabels(labels) ? { priority: priorityFromLabels(labels) } : {}),
    ...(optionalText(value.created_at) ? { createdAt: optionalText(value.created_at) } : {}),
    updatedAt,
    ...(optionalText(value.description) ? { description: optionalText(value.description) } : {}),
    url,
    fields
  }
}

export const gitlabTicketProvider: TicketProviderAdapter = {
  provider: 'gitlab',
  async list(request, context) {
    if (request.source.provider !== 'gitlab') {
      throw new TicketProviderError('INVALID_RESPONSE', 'Source GitLab invalide.')
    }

    const source = request.source
    const baseUrl = (source.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')
    const project = encodeURIComponent(`${source.namespace}/${source.repository}`)
    const perPage = boundedInteger(request.pageSize, 50, 100)
    const page = pageFromCursor(request.cursor)
    const url = new URL(`${baseUrl}/api/v4/projects/${project}/issues`)
    url.searchParams.set('scope', 'all')
    url.searchParams.set('state', 'all')
    url.searchParams.set('per_page', String(perPage))
    url.searchParams.set('page', String(page))
    const titleContains = request.titleContains?.trim()
    if (titleContains) {
      url.searchParams.set('search', titleContains)
      url.searchParams.set('in', 'title')
    }

    let nextPage: string | undefined
    const fetchFn: typeof fetch = async (input, init) => {
      const response = await (context.fetchFn ?? fetch)(input, init)
      const header = response.headers.get('x-next-page')?.trim()
      nextPage = header && /^[1-9]\d*$/.test(header) ? header : undefined
      return response
    }
    const payload = await fetchTicketJson<unknown>(url.toString(), {
      fetchFn,
      signal: context.signal,
      headers: {
        accept: 'application/json',
        ...(context.token ? { authorization: `Bearer ${context.token}` } : {})
      }
    })
    if (!Array.isArray(payload)) {
      throw new TicketProviderError('INVALID_RESPONSE', 'Réponse GitLab invalide.')
    }

    return {
      items: payload.map((issue) => normalizeIssue(issue, source)),
      ...(nextPage ? { cursor: nextPage } : {}),
      hasMore: nextPage !== undefined
    }
  }
}
