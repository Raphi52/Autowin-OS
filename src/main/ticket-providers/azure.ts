import type { TicketItem, TicketRelation } from '../../shared/tickets'
import {
  TicketProviderError,
  fetchTicketJson,
  type TicketProviderAdapter,
  type TicketProviderContext
} from './provider-contract'

const API_VERSION = '7.1'
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 1_000
const WORK_ITEM_BATCH_SIZE = 200

interface AzureWorkItemReference {
  id: number
}

interface AzureWiqlResponse {
  workItems: AzureWorkItemReference[]
}

interface AzureRelation {
  rel: string
  url: string
}

interface AzureWorkItem {
  id: number
  fields: Record<string, unknown>
  relations?: AzureRelation[]
}

interface AzureWorkItemsResponse {
  value: AzureWorkItem[]
}

function invalidResponse(message = 'R?ponse Azure DevOps invalide.'): TicketProviderError {
  return new TicketProviderError('INVALID_RESPONSE', message)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPageSize(pageSize: number | undefined): number {
  if (pageSize === undefined) return DEFAULT_PAGE_SIZE
  if (!Number.isFinite(pageSize)) return DEFAULT_PAGE_SIZE
  return Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize)))
}

function readCursor(cursor: string | undefined): number | undefined {
  if (cursor === undefined) return undefined
  if (!/^[1-9]\d*$/.test(cursor)) {
    throw invalidResponse('Curseur Azure DevOps invalide.')
  }
  const value = Number(cursor)
  if (!Number.isSafeInteger(value)) {
    throw invalidResponse('Curseur Azure DevOps invalide.')
  }
  return value
}

function authorizationHeader(context: TicketProviderContext): string {
  if (!context.token) {
    throw new TicketProviderError('AUTH_REQUIRED', 'Authentification requise.')
  }
  return context.authScheme === 'bearer'
    ? `Bearer ${context.token}`
    : `Basic ${Buffer.from(`:${context.token}`, 'utf8').toString('base64')}`
}

function assertWiqlResponse(value: unknown): asserts value is AzureWiqlResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.workItems) ||
    value.workItems.some(
      (item) => !isRecord(item) || !Number.isSafeInteger(item.id) || Number(item.id) < 1
    )
  ) {
    throw invalidResponse()
  }
}

function assertWorkItemsResponse(value: unknown): asserts value is AzureWorkItemsResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.value) ||
    value.value.some(
      (item) =>
        !isRecord(item) ||
        !Number.isSafeInteger(item.id) ||
        Number(item.id) < 1 ||
        !isRecord(item.fields) ||
        (item.relations !== undefined &&
          (!Array.isArray(item.relations) ||
            item.relations.some(
              (relation) =>
                !isRecord(relation) ||
                typeof relation.rel !== 'string' ||
                typeof relation.url !== 'string'
            )))
    )
  ) {
    throw invalidResponse()
  }
}

function requiredString(fields: Record<string, unknown>, name: string): string {
  const value = fields[name]
  if (typeof value !== 'string' || value.length === 0) throw invalidResponse()
  return value
}

function optionalString(fields: Record<string, unknown>, name: string): string | undefined {
  const value = fields[name]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function assignedTo(fields: Record<string, unknown>): string | undefined {
  const value = fields['System.AssignedTo']
  if (typeof value === 'string' && value.length > 0) return value
  if (!isRecord(value)) return undefined
  for (const key of ['displayName', 'uniqueName']) {
    if (typeof value[key] === 'string' && value[key].length > 0) return value[key]
  }
  return undefined
}

function relationTarget(url: string): string {
  try {
    const pathname = new URL(url).pathname
    return decodeURIComponent(pathname.slice(pathname.lastIndexOf('/') + 1)) || url
  } catch {
    return url
  }
}

function normalizeRelations(relations: AzureRelation[] | undefined): TicketRelation[] | undefined {
  if (!relations?.length) return undefined
  return relations.map((relation) => ({
    kind: relation.rel,
    target: relationTarget(relation.url),
    url: relation.url
  }))
}

function normalizeWorkItem(
  item: AzureWorkItem,
  sourceId: string,
  organization: string,
  project: string
): TicketItem {
  const fields = item.fields
  const createdAt = optionalString(fields, 'System.CreatedDate')
  const assignee = assignedTo(fields)
  const priority = fields['Microsoft.VSTS.Common.Priority']
  const description = optionalString(fields, 'System.Description')
  const relations = normalizeRelations(item.relations)

  return {
    id: String(item.id),
    sourceId,
    type: requiredString(fields, 'System.WorkItemType'),
    title: requiredString(fields, 'System.Title'),
    state: requiredString(fields, 'System.State'),
    url: `https://dev.azure.com/${encodeURIComponent(organization)}/${encodeURIComponent(project)}/_workitems/edit/${item.id}`,
    updatedAt: requiredString(fields, 'System.ChangedDate'),
    ...(createdAt ? { createdAt } : {}),
    ...(assignee ? { assignee } : {}),
    ...(typeof priority === 'string' || typeof priority === 'number' ? { priority } : {}),
    ...(description ? { description } : {}),
    ...(relations ? { relations } : {}),
    fields
  }
}

async function fetchWorkItems(
  baseUrl: string,
  ids: readonly number[],
  authorization: string,
  context: TicketProviderContext
): Promise<AzureWorkItem[]> {
  const items: AzureWorkItem[] = []
  for (let index = 0; index < ids.length; index += WORK_ITEM_BATCH_SIZE) {
    const batch = ids.slice(index, index + WORK_ITEM_BATCH_SIZE)
    const response = await fetchTicketJson<unknown>(
      `${baseUrl}/_apis/wit/workitems?ids=${batch.join(',')}&$expand=Relations&api-version=${API_VERSION}`,
      {
        fetchFn: context.fetchFn,
        signal: context.signal,
        headers: { authorization }
      }
    )
    assertWorkItemsResponse(response)
    const byId = new Map(response.value.map((item) => [item.id, item]))
    for (const id of batch) {
      const item = byId.get(id)
      if (!item) throw invalidResponse()
      items.push(item)
    }
  }
  return items
}

export const azureTicketProvider: TicketProviderAdapter = {
  provider: 'azure',
  async list(request, context) {
    if (request.source.provider !== 'azure') {
      throw invalidResponse('Source Azure DevOps invalide.')
    }

    const source = request.source
    const pageSize = readPageSize(request.pageSize)
    const cursor = readCursor(request.cursor)
    const authorization = authorizationHeader(context)
    const organization = encodeURIComponent(source.organization)
    const project = encodeURIComponent(source.project)
    const baseUrl = `https://dev.azure.com/${organization}/${project}`
    const cursorClause = cursor === undefined ? '' : ` AND [System.Id] > ${cursor}`
    const query =
      'SELECT [System.Id] FROM WorkItems ' +
      `WHERE [System.TeamProject] = @project${cursorClause} ` +
      'ORDER BY [System.Id] ASC'

    const wiqlResponse = await fetchTicketJson<unknown>(
      `${baseUrl}/_apis/wit/wiql?$top=${pageSize + 1}&api-version=${API_VERSION}`,
      {
        fetchFn: context.fetchFn,
        signal: context.signal,
        method: 'POST',
        headers: { authorization },
        body: { query }
      }
    )
    assertWiqlResponse(wiqlResponse)

    const hasMore = wiqlResponse.workItems.length > pageSize
    const pageReferences = wiqlResponse.workItems.slice(0, pageSize)
    const ids = pageReferences.map(({ id }) => id)
    const workItems = await fetchWorkItems(baseUrl, ids, authorization, context)
    const items = workItems.map((item) =>
      normalizeWorkItem(item, source.id, source.organization, source.project)
    )

    return {
      items,
      cursor: hasMore && ids.length > 0 ? String(ids[ids.length - 1]) : undefined,
      hasMore
    }
  }
}
