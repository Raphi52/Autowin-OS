import type { GitLabTicketSource, TicketItem } from '../../shared/tickets'
import {
  fetchTicketJson,
  TicketProviderError,
  type TicketProviderAdapter,
  type TicketProviderContext
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

function gitlabIssueUrl(source: GitLabTicketSource, id: string, suffix = ''): string {
  const baseUrl = (source.baseUrl ?? 'https://gitlab.com').replace(/\/+$/, '')
  const project = encodeURIComponent(`${source.namespace}/${source.repository}`)
  return `${baseUrl}/api/v4/projects/${project}/issues/${id}${suffix}`
}

function gitlabHeaders(context: TicketProviderContext): Record<string, string> {
  return {
    accept: 'application/json',
    ...(context.token ? { authorization: `Bearer ${context.token}` } : {})
  }
}

function positiveIssueId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : ''
  if (!/^[1-9]\d*$/.test(id)) {
    throw new TicketProviderError('INVALID_RESPONSE', 'Identifiant GitLab invalide.')
  }
  return id
}

function gitlabStateEvent(state: string | undefined): string | undefined {
  if (!state) return undefined
  const normalized = state.trim().toLowerCase()
  if (['closed', 'close', 'clos', 'fermé', 'fermee', 'fermée'].includes(normalized)) return 'close'
  if (['open', 'opened', 'reopen', 'ouvert', 'ouverte'].includes(normalized)) return 'reopen'
  throw new TicketProviderError(
    'INVALID_RESPONSE',
    `État GitLab « ${state} » invalide (opened/closed attendu).`
  )
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
  },
  async get(request, context) {
    if (request.source.provider !== 'gitlab') {
      throw new TicketProviderError('INVALID_RESPONSE', 'Source GitLab invalide.')
    }
    const payload = await fetchTicketJson<unknown>(
      gitlabIssueUrl(request.source, positiveIssueId(request.id)),
      {
        fetchFn: context.fetchFn,
        signal: context.signal,
        headers: gitlabHeaders(context)
      }
    )
    return normalizeIssue(payload, request.source)
  },
  async update(request, context) {
    if (request.source.provider !== 'gitlab') {
      throw new TicketProviderError('INVALID_RESPONSE', 'Source GitLab invalide.')
    }
    const id = positiveIssueId(request.id)
    if (request.assignee) {
      throw new TicketProviderError(
        'INVALID_RESPONSE',
        'GitLab exige un identifiant numérique pour changer l’assigné ; assigne-le dans GitLab.'
      )
    }
    const stateEvent = gitlabStateEvent(request.state)
    let updated: unknown
    if (stateEvent) {
      updated = await fetchTicketJson<unknown>(gitlabIssueUrl(request.source, id), {
        fetchFn: context.fetchFn,
        signal: context.signal,
        method: 'PUT',
        headers: gitlabHeaders(context),
        body: { state_event: stateEvent }
      })
    }
    if (request.comment) {
      await fetchTicketJson<unknown>(gitlabIssueUrl(request.source, id, '/notes'), {
        fetchFn: context.fetchFn,
        signal: context.signal,
        method: 'POST',
        headers: gitlabHeaders(context),
        body: { body: request.comment }
      })
    }
    if (!updated) {
      updated = await fetchTicketJson<unknown>(gitlabIssueUrl(request.source, id), {
        fetchFn: context.fetchFn,
        signal: context.signal,
        headers: gitlabHeaders(context)
      })
    }
    return normalizeIssue(updated, request.source)
  }
}
