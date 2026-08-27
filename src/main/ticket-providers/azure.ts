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

/**
 * Type de work item appliqué quand l'appelant n'en fournit aucun. `Tache` est le type custom
 * Amitel-SCRUM (« Suivi d'une tâche à accomplir ») de l'organisation ciblée par
 * `DEFAULT_TICKET_SOURCE`. ⚠️ Le type anglais par défaut `Task` y est DÉSACTIVÉ (l'API répond
 * `VS403074`), il ne peut donc pas servir de défaut.
 */
const DEFAULT_WORK_ITEM_TYPE = 'Tache'

/** L'API de création n'accepte QUE ce content-type (corps = tableau d'opérations JSON-Patch). */
const JSON_PATCH_CONTENT_TYPE = 'application/json-patch+json'

interface AzureWorkItemReference {
  id: number
}

interface AzureWiqlResponse {
  workItems: AzureWorkItemReference[]
}

interface AzureRelation {
  rel: string
  url: string
  attributes?: { name?: unknown }
}

interface AzureWorkItem {
  id: number
  fields: Record<string, unknown>
  relations?: AzureRelation[]
}

interface AzureWorkItemsResponse {
  value: AzureWorkItem[]
}

interface AzureCommentsResponse {
  comments: Array<{
    id?: unknown
    text?: unknown
    createdDate?: unknown
    createdBy?: { displayName?: unknown; uniqueName?: unknown }
  }>
}

function invalidResponse(message = 'Réponse Azure DevOps invalide.'): TicketProviderError {
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

function isWorkItem(item: unknown): item is AzureWorkItem {
  return (
    isRecord(item) &&
    Number.isSafeInteger(item.id) &&
    Number(item.id) >= 1 &&
    isRecord(item.fields) &&
    (item.relations === undefined ||
      (Array.isArray(item.relations) &&
        !item.relations.some(
          (relation) =>
            !isRecord(relation) ||
            typeof relation.rel !== 'string' ||
            typeof relation.url !== 'string'
        )))
  )
}

function assertWorkItemsResponse(value: unknown): asserts value is AzureWorkItemsResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.value) ||
    value.value.some((item) => !isWorkItem(item))
  ) {
    throw invalidResponse()
  }
}

/** La création renvoie le work item SEUL (pas d'enveloppe `{ value: [...] }`). */
function assertCreatedWorkItem(value: unknown): asserts value is AzureWorkItem {
  if (!isWorkItem(value)) {
    throw invalidResponse('Réponse de création Azure DevOps invalide.')
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

function normalizeRelations(
  relations: AzureRelation[] | undefined,
  linkedTitles: ReadonlyMap<string, string> = new Map()
): TicketRelation[] | undefined {
  if (!relations?.length) return undefined
  return relations.map((relation) => {
    const target = relationTarget(relation.url)
    const attachmentName =
      typeof relation.attributes?.name === 'string' ? relation.attributes.name : undefined
    const title = linkedTitles.get(target) ?? attachmentName
    return {
      kind: relation.rel,
      target,
      url: relation.url,
      ...(title ? { title } : {})
    }
  })
}

function normalizeWorkItem(
  item: AzureWorkItem,
  sourceId: string,
  organization: string,
  project: string,
  linkedTitles: ReadonlyMap<string, string> = new Map(),
  comments?: TicketItem['comments']
): TicketItem {
  const fields = item.fields
  const createdAt = optionalString(fields, 'System.CreatedDate')
  const assignee = assignedTo(fields)
  const priority = fields['Microsoft.VSTS.Common.Priority']
  const description = optionalString(fields, 'System.Description')
  const relations = normalizeRelations(item.relations, linkedTitles)

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
    ...(comments?.length ? { comments } : {}),
    fields
  }
}

function linkedWorkItemIds(relations: AzureRelation[] | undefined): number[] {
  if (!relations?.length) return []
  const ids = new Set<number>()
  for (const relation of relations) {
    if (!/\/_apis\/wit\/workitems\//i.test(relation.url)) continue
    const target = relationTarget(relation.url)
    if (/^[1-9]\d*$/.test(target)) ids.add(Number(target))
  }
  return [...ids]
}

async function fetchComments(
  baseUrl: string,
  id: string,
  authorization: string,
  context: TicketProviderContext
): Promise<TicketItem['comments']> {
  const response = await fetchTicketJson<unknown>(
    `${baseUrl}/_apis/wit/workItems/${id}/comments?$top=20&api-version=${API_VERSION}-preview.4`,
    {
      fetchFn: context.fetchFn,
      signal: context.signal,
      headers: { authorization }
    }
  )
  if (!isRecord(response) || !Array.isArray(response.comments)) throw invalidResponse()
  return (response as unknown as AzureCommentsResponse).comments.flatMap((comment) => {
    if (typeof comment.text !== 'string' || !comment.text.trim()) return []
    const author =
      typeof comment.createdBy?.displayName === 'string'
        ? comment.createdBy.displayName
        : typeof comment.createdBy?.uniqueName === 'string'
          ? comment.createdBy.uniqueName
          : undefined
    return [
      {
        ...(typeof comment.id === 'number' || typeof comment.id === 'string'
          ? { id: String(comment.id) }
          : {}),
        ...(author ? { author } : {}),
        ...(typeof comment.createdDate === 'string' ? { createdAt: comment.createdDate } : {}),
        text: comment.text
      }
    ]
  })
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

interface AzureTeamsResponse {
  value: Array<{ id: string }>
}

interface AzureTeamMembersResponse {
  value: Array<{ identity?: { displayName?: string; uniqueName?: string } }>
}

function assertTeamsResponse(value: unknown): asserts value is AzureTeamsResponse {
  if (
    !isRecord(value) ||
    !Array.isArray(value.value) ||
    value.value.some((team) => !isRecord(team) || typeof team.id !== 'string')
  ) {
    throw invalidResponse()
  }
}

function assertTeamMembersResponse(value: unknown): asserts value is AzureTeamMembersResponse {
  if (!isRecord(value) || !Array.isArray(value.value)) throw invalidResponse()
}

/** Borne le scan d'équipes (annuaire, pas exhaustivité) : un projet à N équipes ne déclenche pas N appels. */
const TEAM_SCAN_CAP = 10

/**
 * COLLABORATEURS du projet (autocomplete assigné) : équipes du projet → membres, dédupliqués par nom
 * affiché. Endpoint Core `_apis/projects/{project}/teams` + `/teams/{id}/members` (mêmes credentials
 * que les work items). Best-effort côté appelant : une erreur ⇒ liste vide, jamais bloquant.
 */
export async function listAzurePeople(
  source: { organization: string; project: string },
  context: TicketProviderContext
): Promise<string[]> {
  const authorization = authorizationHeader(context)
  const organization = encodeURIComponent(source.organization)
  const project = encodeURIComponent(source.project)
  const orgUrl = `https://dev.azure.com/${organization}`
  const teamsResponse = await fetchTicketJson<unknown>(
    `${orgUrl}/_apis/projects/${project}/teams?api-version=${API_VERSION}`,
    { fetchFn: context.fetchFn, signal: context.signal, headers: { authorization } }
  )
  assertTeamsResponse(teamsResponse)
  const people = new Set<string>()
  for (const team of teamsResponse.value.slice(0, TEAM_SCAN_CAP)) {
    const membersResponse = await fetchTicketJson<unknown>(
      `${orgUrl}/_apis/projects/${project}/teams/${encodeURIComponent(team.id)}/members?api-version=${API_VERSION}`,
      { fetchFn: context.fetchFn, signal: context.signal, headers: { authorization } }
    )
    assertTeamMembersResponse(membersResponse)
    for (const member of membersResponse.value) {
      const identity = member.identity
      const name =
        (typeof identity?.displayName === 'string' && identity.displayName) ||
        (typeof identity?.uniqueName === 'string' && identity.uniqueName) ||
        ''
      if (name) people.add(name)
    }
  }
  return [...people].sort((a, b) => a.localeCompare(b))
}

/**
 * Clause WIQL de recherche par titre, ou chaîne vide si aucune recherche n'est demandée.
 *
 * SÉCURITÉ — WIQL n'offre PAS de requête paramétrée : la valeur est interpolée dans le texte de la
 * requête, et l'échappement est notre seule défense. Une apostrophe non doublée refermerait le
 * littéral et laisserait injecter la suite de la clause (`x' OR [System.Id] > 0 OR '` ramènerait tout
 * le projet). La convention WIQL, comme en SQL, est de DOUBLER l'apostrophe.
 *
 * Vide ou blanc rend `''` : aucun filtre. Ne JAMAIS produire `CONTAINS ''`, qui matcherait tout et
 * ferait passer une recherche ratée pour une recherche exhaustive.
 */
function wiqlTitleClause(titleContains: string | undefined): string {
  const needle = typeof titleContains === 'string' ? titleContains.trim() : ''
  if (!needle) return ''
  return ` AND [System.Title] CONTAINS '${needle.replace(/'/g, "''")}'`
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
    /**
     * ORDRE DÉCROISSANT — la fenêtre chargée doit être celle des fiches les PLUS RÉCENTES.
     * En ASC, la première page ramenait les plus VIEUX identifiants du projet : la vue triait
     * ensuite « plus récents » sur cet échantillon ancien, donc l'utilisateur ne voyait jamais
     * les fiches du jour. Le curseur suit l'ordre : il DESCEND (`<`) au lieu de monter.
     */
    const cursorClause = cursor === undefined ? '' : ` AND [System.Id] < ${cursor}`
    const searchClause = wiqlTitleClause(request.titleContains)
    const query =
      'SELECT [System.Id] FROM WorkItems ' +
      `WHERE [System.TeamProject] = @project${cursorClause}${searchClause} ` +
      'ORDER BY [System.Id] DESC'

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
  },

  /**
   * Lecture directe d'une fiche par son id. Réutilise `fetchWorkItems` — le chemin déjà éprouvé par
   * `list` — plutôt qu'un second appel écrit pour l'occasion : une seule normalisation, un seul
   * traitement des lots et des absences.
   */
  async get(request, context) {
    if (request.source.provider !== 'azure') {
      throw invalidResponse('Source Azure DevOps invalide.')
    }
    // L'id est interpolé dans l'URL : on n'accepte QUE des entiers positifs. Un `../../` ou un
    // fragment de requête n'a rien à faire dans un chemin d'API.
    const raw = typeof request.id === 'string' ? request.id.trim() : ''
    if (!/^[1-9]\d*$/.test(raw)) {
      throw invalidResponse(`Identifiant de fiche Azure DevOps invalide : « ${raw} ».`)
    }
    const source = request.source
    const authorization = authorizationHeader(context)
    const organization = encodeURIComponent(source.organization)
    const project = encodeURIComponent(source.project)
    const baseUrl = `https://dev.azure.com/${organization}/${project}`

    const [item] = await fetchWorkItems(baseUrl, [Number(raw)], authorization, context)
    if (!item) throw invalidResponse(`Fiche Azure DevOps ${raw} introuvable.`)
    let linkedTitles = new Map<string, string>()
    const linkedIds = linkedWorkItemIds(item.relations)
    if (linkedIds.length) {
      try {
        const linked = await fetchWorkItems(baseUrl, linkedIds, authorization, context)
        linkedTitles = new Map(
          linked.flatMap((candidate) => {
            const title = optionalString(candidate.fields, 'System.Title')
            return title ? [[String(candidate.id), title] as const] : []
          })
        )
      } catch {
        // L'enrichissement d'une relation ne doit pas rendre la fiche principale illisible.
      }
    }
    let comments: TicketItem['comments']
    try {
      comments = await fetchComments(baseUrl, raw, authorization, context)
    } catch {
      // Un PAT sans scope Comments garde l'accès au work item ; on dégrade explicitement en absence.
    }
    return normalizeWorkItem(
      item,
      source.id,
      source.organization,
      source.project,
      linkedTitles,
      comments
    )
  },
  async update(request, context) {
    if (request.source.provider !== 'azure') {
      throw invalidResponse('Source Azure DevOps invalide.')
    }
    const raw = typeof request.id === 'string' ? request.id.trim() : ''
    if (!/^[1-9]\d*$/.test(raw)) {
      throw invalidResponse(`Identifiant de fiche Azure DevOps invalide : « ${raw} ».`)
    }
    const source = request.source
    const authorization = authorizationHeader(context)
    const organization = encodeURIComponent(source.organization)
    const project = encodeURIComponent(source.project)
    const baseUrl = `https://dev.azure.com/${organization}/${project}`
    const operations = [
      ...(request.state ? [{ op: 'add', path: '/fields/System.State', value: request.state }] : []),
      ...(request.assignee
        ? [{ op: 'add', path: '/fields/System.AssignedTo', value: request.assignee }]
        : [])
    ]

    let updated: AzureWorkItem | undefined
    if (operations.length) {
      const response = await fetchTicketJson<unknown>(
        `${baseUrl}/_apis/wit/workitems/${raw}?api-version=${API_VERSION}`,
        {
          fetchFn: context.fetchFn,
          signal: context.signal,
          method: 'PATCH',
          headers: { authorization },
          contentType: JSON_PATCH_CONTENT_TYPE,
          body: operations
        }
      )
      assertCreatedWorkItem(response)
      updated = response
    }
    if (request.comment) {
      await fetchTicketJson<unknown>(
        `${baseUrl}/_apis/wit/workItems/${raw}/comments?api-version=${API_VERSION}-preview.4`,
        {
          fetchFn: context.fetchFn,
          signal: context.signal,
          method: 'POST',
          headers: { authorization },
          body: { text: request.comment }
        }
      )
    }
    if (!updated) {
      const [current] = await fetchWorkItems(baseUrl, [Number(raw)], authorization, context)
      if (!current) throw invalidResponse(`Fiche Azure DevOps ${raw} introuvable.`)
      updated = current
    }
    return normalizeWorkItem(updated, source.id, source.organization, source.project)
  },
  async create(request, context) {
    if (request.source.provider !== 'azure') {
      throw invalidResponse('Source Azure DevOps invalide.')
    }

    const source = request.source
    const title = request.title?.trim() ?? ''
    if (title.length === 0) {
      throw invalidResponse('Titre obligatoire pour créer une fiche Azure DevOps.')
    }
    const description = request.description?.trim()
    const assignee = request.assignee?.trim()
    const workItemType = request.workItemType?.trim() || DEFAULT_WORK_ITEM_TYPE

    const authorization = authorizationHeader(context)
    const organization = encodeURIComponent(source.organization)
    const project = encodeURIComponent(source.project)
    // Le segment de type est préfixé d'un `$` littéral, exigé par l'API de création.
    const url = `https://dev.azure.com/${organization}/${project}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=${API_VERSION}`

    const operations = [
      { op: 'add', path: '/fields/System.Title', value: title },
      ...(description
        ? [{ op: 'add', path: '/fields/System.Description', value: description }]
        : []),
      ...(assignee ? [{ op: 'add', path: '/fields/System.AssignedTo', value: assignee }] : [])
    ]

    const response = await fetchTicketJson<unknown>(url, {
      fetchFn: context.fetchFn,
      signal: context.signal,
      method: 'POST',
      headers: { authorization },
      contentType: JSON_PATCH_CONTENT_TYPE,
      body: operations
    })
    assertCreatedWorkItem(response)

    return normalizeWorkItem(response, source.id, source.organization, source.project)
  }
}
