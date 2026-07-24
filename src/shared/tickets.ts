export type TicketProvider = 'azure' | 'github' | 'gitlab'

interface TicketSourceBase {
  id: string
  label: string
  provider: TicketProvider
}

export interface AzureTicketSource extends TicketSourceBase {
  provider: 'azure'
  organization: string
  project: string
  repository?: string
}

export interface GitHubTicketSource extends TicketSourceBase {
  provider: 'github'
  owner: string
  repository: string
  apiBaseUrl?: string
}

export interface GitLabTicketSource extends TicketSourceBase {
  provider: 'gitlab'
  namespace: string
  repository: string
  baseUrl?: string
}

export type TicketSourceProfile = AzureTicketSource | GitHubTicketSource | GitLabTicketSource

export interface TicketSourceSummary {
  profile: TicketSourceProfile
  credentialConfigured: boolean
}

export interface TicketRelation {
  kind: string
  target: string
  url?: string
}

export interface TicketItem {
  id: string
  sourceId: string
  type: string
  title: string
  state: string
  url: string
  updatedAt: string
  createdAt?: string
  assignee?: string
  priority?: string | number
  description?: string
  relations?: TicketRelation[]
  fields: Record<string, unknown>
}

export interface TicketPage {
  items: TicketItem[]
  cursor?: string
  hasMore: boolean
}

export interface TicketListRequest {
  source: TicketSourceProfile
  requestId?: string
  cursor?: string
  pageSize?: number
}

export const DEFAULT_TICKET_SOURCE: AzureTicketSource = {
  id: 'azure:AmitelGTC:RIG:RigApplication',
  label: 'AmitelGTC / RIG / RigApplication',
  provider: 'azure',
  organization: 'AmitelGTC',
  project: 'RIG',
  repository: 'RigApplication'
}

const PROVIDER_KEYS: Record<TicketProvider, ReadonlySet<string>> = {
  azure: new Set(['id', 'label', 'provider', 'organization', 'project', 'repository']),
  github: new Set(['id', 'label', 'provider', 'owner', 'repository', 'apiBaseUrl']),
  gitlab: new Set(['id', 'label', 'provider', 'namespace', 'repository', 'baseUrl'])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isSafeText(value: unknown, maxLength = 256): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    // eslint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  )
}

function isOptionalSafeText(value: unknown): value is string | undefined {
  return value === undefined || isSafeText(value)
}

/** H?te s?r ? transmettre comme argument aux CLI forge, port optionnel inclus. */
export function isSafeForgeHost(host: string): boolean {
  const ipv6 = host.match(/^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i)
  if (ipv6) {
    return !ipv6[2] || Number(ipv6[2]) <= 65_535
  }
  const separator = host.lastIndexOf(':')
  const hostname = separator === -1 ? host : host.slice(0, separator)
  const port = separator === -1 ? undefined : host.slice(separator + 1)
  if (port && (!/^\d{1,5}$/.test(port) || Number(port) > 65_535)) return false
  const normalized = hostname.endsWith('.') ? hostname.slice(0, -1) : hostname
  return (
    normalized.length > 0 &&
    normalized.length <= 253 &&
    normalized.split('.').every(
      (label) =>
        label.length > 0 &&
        label.length <= 63 &&
        /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
    )
  )
}

function isSafeHttpsUrl(value: unknown): value is string | undefined {
  if (value === undefined) return true
  if (!isSafeText(value, 2048)) return false
  try {
    const parsed = new URL(value)
    return (
      parsed.protocol === 'https:' &&
      parsed.username === '' &&
      parsed.password === '' &&
      isSafeForgeHost(parsed.host) &&
      parsed.search === '' &&
      parsed.hash === ''
    )
  } catch {
    return false
  }
}

export function parseTicketSourceProfile(value: unknown): TicketSourceProfile | null {
  if (!isRecord(value) || !isSafeText(value.provider)) return null
  if (value.provider !== 'azure' && value.provider !== 'github' && value.provider !== 'gitlab') {
    return null
  }
  const allowed = PROVIDER_KEYS[value.provider]
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  if (!isSafeText(value.id) || !isSafeText(value.label)) return null

  if (value.provider === 'azure') {
    if (
      !isSafeText(value.organization) ||
      !isSafeText(value.project) ||
      !isOptionalSafeText(value.repository)
    ) {
      return null
    }
    return {
      id: value.id,
      label: value.label,
      provider: 'azure',
      organization: value.organization,
      project: value.project,
      ...(value.repository ? { repository: value.repository } : {})
    }
  }

  if (value.provider === 'github') {
    if (
      !isSafeText(value.owner) ||
      !isSafeText(value.repository) ||
      !isSafeHttpsUrl(value.apiBaseUrl)
    ) {
      return null
    }
    return {
      id: value.id,
      label: value.label,
      provider: 'github',
      owner: value.owner,
      repository: value.repository,
      ...(value.apiBaseUrl ? { apiBaseUrl: value.apiBaseUrl } : {})
    }
  }

  if (
    !isSafeText(value.namespace) ||
    !isSafeText(value.repository) ||
    !isSafeHttpsUrl(value.baseUrl)
  ) {
    return null
  }
  return {
    id: value.id,
    label: value.label,
    provider: 'gitlab',
    namespace: value.namespace,
    repository: value.repository,
    ...(value.baseUrl ? { baseUrl: value.baseUrl } : {})
  }
}

export function canonicalTicketId(item: Pick<TicketItem, 'sourceId' | 'id'>): string {
  return `${item.sourceId}::${item.id}`
}
