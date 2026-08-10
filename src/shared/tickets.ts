export type TicketProvider = 'azure' | 'github' | 'gitlab'

interface TicketSourceBase {
  id: string
  label: string
  provider: TicketProvider
  /**
   * CONTEXTE D'EXÉCUTION — déclaré par l'utilisateur sur la SOURCE, jamais deviné.
   *
   * Un ticket dit QUOI faire ; il ne dit jamais dans quel dépôt, sur quelle branche, avec quelle
   * convention de commit, ni comment vérifier. Sans ces éléments l'agent invente — et invente mal.
   * Ils sont donc OPTIONNELS et strictement déclaratifs : absents, ils ne sont pas injectés dans le
   * prompt (aucune valeur par défaut inventée).
   */
  branchPrefix?: string
  commitConvention?: string
  verifyCommand?: string
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
  /**
   * Titre LISIBLE de la fiche liée. Sans lui, une relation est un id nu (« target: 2041 ») : le
   * lecteur — humain ou agent — ne peut pas savoir si c'est un doublon, un parent ou un bloquant
   * sans une lecture supplémentaire. Optionnel : le fournisseur ne le remonte pas toujours.
   */
  title?: string
}

/** Un message de la discussion d'une fiche. `text` est du TEXTE BRUT (jamais du HTML). */
export interface TicketComment {
  id?: string
  author?: string
  createdAt?: string
  text: string
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
  /** Discussion de la fiche, du plus ancien au plus récent. Souvent l'information décisive. */
  comments?: TicketComment[]
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
  /**
   * Filtre par SOUS-CHAÎNE du titre. Sans lui, la lecture balaie tout le projet par id croissant :
   * répondre à « existe-t-il déjà une fiche sur ce sujet ? » demanderait de parcourir des milliers
   * d'items. Vide ou blanc = aucun filtre (et NON « aucun résultat »).
   */
  titleContains?: string
}

export const DEFAULT_TICKET_SOURCE: AzureTicketSource = {
  id: 'azure:AmitelGTC:RIG:RigApplication',
  label: 'AmitelGTC / RIG / RigApplication',
  provider: 'azure',
  organization: 'AmitelGTC',
  project: 'RIG',
  repository: 'RigApplication'
}

/** Clés du contexte d'exécution, communes aux trois fournisseurs. */
const EXECUTION_KEYS = ['branchPrefix', 'commitConvention', 'verifyCommand'] as const

const PROVIDER_KEYS: Record<TicketProvider, ReadonlySet<string>> = {
  azure: new Set([
    'id',
    'label',
    'provider',
    'organization',
    'project',
    'repository',
    ...EXECUTION_KEYS
  ]),
  github: new Set([
    'id',
    'label',
    'provider',
    'owner',
    'repository',
    'apiBaseUrl',
    ...EXECUTION_KEYS
  ]),
  gitlab: new Set([
    'id',
    'label',
    'provider',
    'namespace',
    'repository',
    'baseUrl',
    ...EXECUTION_KEYS
  ])
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
    normalized
      .split('.')
      .every(
        (label) =>
          label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label)
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

/**
 * Champs du contexte d'exécution, validés et NORMALISÉS : chaque champ absent, vide ou invalide est
 * simplement OMIS (`null` signale un rejet du profil entier). Le prompt n'injectera donc jamais une
 * valeur douteuse — il n'injectera rien.
 */
function executionFields(
  value: Record<string, unknown>
): Pick<TicketSourceBase, 'branchPrefix' | 'commitConvention' | 'verifyCommand'> | null {
  const result: Record<string, string> = {}
  for (const key of EXECUTION_KEYS) {
    const raw = value[key]
    if (raw === undefined) continue
    if (!isSafeText(raw, 500)) return null
    const trimmed = raw.trim()
    if (trimmed) result[key] = trimmed
  }
  return result
}

export function parseTicketSourceProfile(value: unknown): TicketSourceProfile | null {
  if (!isRecord(value) || !isSafeText(value.provider)) return null
  if (value.provider !== 'azure' && value.provider !== 'github' && value.provider !== 'gitlab') {
    return null
  }
  const allowed = PROVIDER_KEYS[value.provider]
  if (Object.keys(value).some((key) => !allowed.has(key))) return null
  if (!isSafeText(value.id) || !isSafeText(value.label)) return null
  const execution = executionFields(value)
  if (!execution) return null

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
      ...(value.repository ? { repository: value.repository } : {}),
      ...execution
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
      ...(value.apiBaseUrl ? { apiBaseUrl: value.apiBaseUrl } : {}),
      ...execution
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
    ...(value.baseUrl ? { baseUrl: value.baseUrl } : {}),
    ...execution
  }
}

export function canonicalTicketId(item: Pick<TicketItem, 'sourceId' | 'id'>): string {
  return `${item.sourceId}::${item.id}`
}

/**
 * CONTEXTE D'EXÉCUTION résolu pour UNE fiche. Chaque champ est présent UNIQUEMENT s'il découle de
 * données réellement déclarées : aucun dépôt, aucune branche, aucune commande n'est inventée.
 */
export interface TicketExecutionContext {
  repository?: string
  branch?: string
  commitConvention?: string
  verifyCommand?: string
}

/** Fragment de branche sûr : minuscules, tirets, jamais vide-ambigu. */
function branchSlug(title: string): string {
  return title
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '')
}

/** Dépôt CIBLE déclaré sur la source, sous sa forme canonique, ou `undefined` s'il n'y en a pas. */
export function ticketTargetRepository(source: TicketSourceProfile): string | undefined {
  if (source.provider === 'azure') return source.repository
  if (source.provider === 'github') return `${source.owner}/${source.repository}`
  return `${source.namespace}/${source.repository}`
}

export function ticketExecutionContext(
  source: TicketSourceProfile | undefined,
  item: Pick<TicketItem, 'id' | 'title'>
): TicketExecutionContext {
  if (!source) return {}
  const repository = ticketTargetRepository(source)
  const slug = branchSlug(item.title ?? '')
  // La branche n'est proposée QUE si la source déclare une convention de préfixe : sans elle,
  // nommer une branche serait une invention.
  const branch = source.branchPrefix
    ? `${source.branchPrefix.replace(/\/+$/, '')}/${item.id}${slug ? `-${slug}` : ''}`
    : undefined
  return {
    ...(repository ? { repository } : {}),
    ...(branch ? { branch } : {}),
    ...(source.commitConvention ? { commitConvention: source.commitConvention } : {}),
    ...(source.verifyCommand ? { verifyCommand: source.verifyCommand } : {})
  }
}

/**
 * Requête de LISTE normalisée — le seul endroit qui décide de ce qui part au main.
 *
 * Motif : la vue filtrait le titre CÔTÉ CLIENT sur les 50 items déjà chargés ; chercher une fiche
 * plus ancienne ne renvoyait rien alors qu'elle existait. `titleContains` (déjà au contrat) doit
 * donc être transmis. Une recherche vide/blanche est OMISE (aucun filtre), jamais envoyée vide.
 */
export function buildTicketListRequest(input: {
  source: TicketSourceProfile
  requestId?: string
  cursor?: string
  pageSize?: number
  titleContains?: string
}): TicketListRequest {
  const search = typeof input.titleContains === 'string' ? input.titleContains.trim() : ''
  return {
    source: input.source,
    ...(input.requestId ? { requestId: input.requestId } : {}),
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.pageSize ? { pageSize: input.pageSize } : {}),
    ...(search ? { titleContains: search } : {})
  }
}
