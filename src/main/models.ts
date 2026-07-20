// Source CANONIQUE des modèles réellement disponibles dans Autowin OS.
//
// Un « modèle importé » est un objet de première classe : c'est LUI qu'on
// glisse sur un slot de topologie (orchestrateur / sous-agent / scout / judge).
// La liste est BORNÉE par ce que les adaptateurs providers savent réellement
// piloter — on n'invente jamais un modèle qui n'existe pas. Le seed par défaut
// reflète les voies vérifiées (catalogue du compte ChatGPT ; Claude CLI → alias
// --model réels) et l'utilisateur peut importer/supprimer explicitement.

import type { ReasoningEffort } from './roles'
import { loadTokens, type Tokens } from './providers/codex-auth'

/** Un modèle importé, atomique et adressable par son `id` canonique. */
export interface ImportedModel {
  /** Identité canonique stable (ex. 'codex/gpt-5.6-terra', 'claude/opus'). */
  id: string
  /** Adaptateur provider qui sait piloter ce modèle ('claude' | 'codex' | …). */
  provider: string
  /** Identifiant de transport passé à l'adaptateur (`--model` CLI, champ `model` HTTP). */
  model: string
  /** Libellé lisible pour la bibliothèque. */
  label: string
  /** Efforts de raisonnement RÉELLEMENT supportés par ce modèle sur sa voie. */
  reasoningEfforts: ReasoningEffort[]
  /** Effort par défaut (∈ reasoningEfforts) proposé lors d'un binding. */
  defaultReasoningEffort: ReasoningEffort
}

/**
 * Seed de repli — borné aux voies vérifiées, JAMAIS un modèle inventé.
 * - Codex : `gpt-5.6-terra` reste le repli hors ligne vérifié.
 * - Claude : modèles exposés par le bridge local `/models`. Le CLI installé expose
 *   `--effort low|medium|high|xhigh|max` et accepte les identifiants complets.
 */
export const DEFAULT_IMPORTED_MODELS: ImportedModel[] = [
  {
    id: 'codex/gpt-5.6-terra',
    provider: 'codex',
    model: 'gpt-5.6-terra',
    label: 'GPT-5.6 Terra · Codex',
    reasoningEfforts: ['minimal', 'low', 'medium', 'high'],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'claude/claude-fable-5',
    provider: 'claude',
    model: 'claude-fable-5',
    label: 'Claude Fable 5 · CLI',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high'
  },
  {
    id: 'claude/claude-haiku-4-5-20251001',
    provider: 'claude',
    model: 'claude-haiku-4-5-20251001',
    label: 'Claude Haiku 4.5 · CLI',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'medium'
  },
  {
    id: 'claude/claude-opus-4-6',
    provider: 'claude',
    model: 'claude-opus-4-6',
    label: 'Claude Opus 4.6 · CLI',
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    defaultReasoningEffort: 'high'
  },
  {
    // Alias officiel Kimi Code pour les comptes OAuth (pas une clé API).
    // Le CLI sélectionne ensuite le modèle effectivement autorisé par le compte.
    id: 'kimi/kimi-code/kimi-for-coding',
    provider: 'kimi',
    model: 'kimi-code/kimi-for-coding',
    label: 'Kimi Code · compte OAuth',
    reasoningEfforts: ['none'],
    defaultReasoningEffort: 'none'
  }
]

const CLAUDE_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
const CODEX_MODELS_URL = 'https://chatgpt.com/backend-api/codex/models?client_version=0.0.0'
const REASONING_EFFORTS = new Set<ReasoningEffort>([
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'ultra'
])

interface CodexModelPayload {
  slug?: unknown
  display_name?: unknown
  default_reasoning_level?: unknown
  supported_reasoning_levels?: Array<{ effort?: unknown }>
}

interface OmniRouteCredentialReader {
  get(): string | null
}

const OMNIROUTE_ROUTE_LABELS: Record<string, string> = {
  auto: 'Sélection automatique',
  'auto/coding': 'Automatique · Code',
  'auto/reasoning': 'Automatique · Raisonnement',
  'auto/best-coding': 'Meilleur modèle · Code',
  'auto/best-reasoning': 'Meilleur modèle · Raisonnement',
  'auto/cheap': 'Économique · Automatique',
  'custom:priority-chain': 'Chaîne prioritaire personnalisée'
}

/** Libellé humain uniquement ; l'identifiant de transport reste strictement inchangé. */
export function labelOmniRouteModel(id: string): string {
  const known = OMNIROUTE_ROUTE_LABELS[id]
  if (known) return known
  let cleanId = id
  let suffix = ''
  if (cleanId.startsWith('no-think/')) {
    cleanId = cleanId.slice('no-think/'.length)
    suffix = ' · Sans raisonnement'
  }
  cleanId = cleanId.replace(
    /^(?:cc|claude|cx|codex|aug|ddgw|oc|tllm|veo|veoaifree|mcode)\//i,
    ''
  )
  if (cleanId.startsWith('claude-')) {
    return `${labelClaudeModel(cleanId).replace(/ · CLI$/, '')}${suffix}`
  }
  const claudeAlternate = /^claude[_-](\d+)[_.-](\d+)[_-](opus|sonnet|haiku)$/i.exec(cleanId)
  if (claudeAlternate) {
    const [, major, minor, family] = claudeAlternate
    return `Claude ${family.charAt(0).toUpperCase()}${family.slice(1).toLowerCase()} ${major}.${minor}${suffix}`
  }
  const gpt = /^gpt[-_](\d+)(?:[._-](\d+|o))?(?:[-_](.+))?$/i.exec(cleanId)
  if (gpt) {
    const detail = gpt[3]
      ?.split(/[-_/]+/)
      .map((part) => {
        const translated: Record<string, string> = {
          xhigh: 'Très élevé',
          high: 'Élevé',
          medium: 'Moyen',
          low: 'Léger'
        }
        return translated[part.toLowerCase()] ?? part.charAt(0).toUpperCase() + part.slice(1)
      })
      .join(' · ')
    const version = `${gpt[1]}${gpt[2] ? `.${gpt[2]}` : ''}`
    return `GPT-${version}${detail ? ` ${detail}` : ''}${suffix}`
  }
  const generic = cleanId
    .split(/[/:_-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
    .replace(/\b(\d+) (\d+)\b/, '$1.$2')
  return `${generic}${suffix}`
}

async function readBoundedJson(response: Response, maxBytes = 1024 * 1024): Promise<unknown> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error('response-too-large')
  if (!response.body) throw new Error('response-empty')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      received += value.byteLength
      if (received > maxBytes) {
        await reader.cancel('response-too-large')
        throw new Error('response-too-large')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const merged = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(merged))
}

export async function discoverOmniRouteModels(
  fetchFn: typeof fetch,
  credentialStore: OmniRouteCredentialReader
): Promise<ImportedModel[]> {
  let credential: string | null
  try {
    credential = credentialStore.get()
  } catch {
    return []
  }
  if (!credential) return []
  try {
    const response = await fetchFn('http://127.0.0.1:20128/v1/models', {
      method: 'GET',
      headers: { authorization: `Bearer ${credential}`, accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(3_000)
    })
    if (!response.ok) return []
    if (!(response.headers.get('content-type') ?? '').toLowerCase().includes('application/json')) {
      return []
    }
    const payload = (await readBoundedJson(response)) as { object?: unknown; data?: unknown }
    if (payload?.object !== 'list' || !Array.isArray(payload.data)) return []
    return payload.data.flatMap<ImportedModel>((entry) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const id = (entry as { id?: unknown }).id
      if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9._:/-]{0,119}$/i.test(id)) return []
      return [{
        id: `omniroute/${id}`,
        provider: 'omniroute',
        model: id,
        label: labelOmniRouteModel(id),
        reasoningEfforts: ['none'],
        defaultReasoningEffort: 'none'
      }]
    })
  } catch {
    return []
  }
}

async function discoverCodexModels(
  fetchFn: typeof fetch,
  loadTokensFn: () => Tokens | null
): Promise<ImportedModel[]> {
  const tokens = loadTokensFn()
  if (!tokens) return [DEFAULT_IMPORTED_MODELS[0]]
  try {
    const response = await fetchFn(CODEX_MODELS_URL, {
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        originator: 'codex_cli_rs',
        'User-Agent': 'codex_cli_rs/0.0.0 (autowin-os)'
      },
      signal: AbortSignal.timeout(4_000)
    })
    if (!response.ok) return [DEFAULT_IMPORTED_MODELS[0]]
    const payload = (await response.json()) as { models?: CodexModelPayload[] }
    const discovered = (payload.models ?? []).flatMap<ImportedModel>((entry) => {
      if (typeof entry.slug !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(entry.slug)) return []
      const efforts = (entry.supported_reasoning_levels ?? [])
        .map((level) => level.effort)
        .filter(
          (effort): effort is ReasoningEffort =>
            typeof effort === 'string' && REASONING_EFFORTS.has(effort as ReasoningEffort)
        )
      if (efforts.length === 0) return []
      const requestedDefault = entry.default_reasoning_level
      const defaultReasoningEffort =
        typeof requestedDefault === 'string' &&
        efforts.includes(requestedDefault as ReasoningEffort)
          ? (requestedDefault as ReasoningEffort)
          : efforts[0]
      return [
        {
          id: `codex/${entry.slug}`,
          provider: 'codex',
          model: entry.slug,
          label: `${typeof entry.display_name === 'string' ? entry.display_name : entry.slug} · ChatGPT`,
          reasoningEfforts: efforts,
          defaultReasoningEffort
        }
      ]
    })
    return discovered.length > 0 ? discovered : [DEFAULT_IMPORTED_MODELS[0]]
  } catch {
    return [DEFAULT_IMPORTED_MODELS[0]]
  }
}

function labelClaudeModel(id: string): string {
  const match = /^claude-(fable|haiku|opus|sonnet)-(\d+)(?:-(\d+))?(?:-(\d{8}))?$/.exec(id)
  if (!match) return `${id} · CLI`
  const [, family, major, minor, date] = match
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  return `Claude ${name} ${major}${minor ? `.${minor}` : ''}${date ? ` (${date})` : ''} · CLI`
}

/**
 * Découvre indépendamment les catalogues ChatGPT et Claude/Fable réellement exposés.
 * Une indisponibilité d'une voie retombe sur son seed vérifié, sans inventer de noms.
 */
export async function discoverImportedModels(
  fetchFn: typeof fetch = fetch,
  loadTokensFn: () => Tokens | null = loadTokens,
  omniRouteCredentialStore?: OmniRouteCredentialReader
): Promise<ImportedModel[]> {
  const omniRouteModels = omniRouteCredentialStore
    ? await discoverOmniRouteModels(fetchFn, omniRouteCredentialStore)
    : []
  const codexModels = await discoverCodexModels(fetchFn, loadTokensFn)
  try {
    const response = await fetchFn('http://127.0.0.1:8787/models', {
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return DEFAULT_IMPORTED_MODELS
    const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const discovered = (payload.data ?? [])
      .map((entry) => entry.id)
      .filter((id): id is string => typeof id === 'string' && /^claude-[a-z0-9-]+$/.test(id))
      .map<ImportedModel>((model) => ({
        id: `claude/${model}`,
        provider: 'claude',
        model,
        label: labelClaudeModel(model),
        reasoningEfforts: [...CLAUDE_EFFORTS],
        defaultReasoningEffort: model.includes('haiku') ? 'medium' : 'high'
      }))
    return [
      ...codexModels,
      ...discovered,
      ...DEFAULT_IMPORTED_MODELS.filter((model) => model.provider === 'kimi'),
      ...omniRouteModels
    ]
  } catch {
    return [
      ...codexModels,
      ...DEFAULT_IMPORTED_MODELS.filter((model) => model.provider !== 'codex'),
      ...omniRouteModels
    ]
  }
}

/** Validation stricte d'un modèle importé (avant persistance). */
export function assertImportedModel(model: ImportedModel): ImportedModel {
  const fields: Array<[keyof ImportedModel, unknown]> = [
    ['id', model.id],
    ['provider', model.provider],
    ['model', model.model],
    ['label', model.label]
  ]
  for (const [name, value] of fields) {
    if (typeof value !== 'string' || !value.trim()) {
      throw new Error(`Modèle importé invalide : champ « ${String(name)} » vide`)
    }
  }
  if (!Array.isArray(model.reasoningEfforts) || model.reasoningEfforts.length === 0) {
    throw new Error(`Modèle importé « ${model.id} » : reasoningEfforts vide`)
  }
  if (!model.reasoningEfforts.includes(model.defaultReasoningEffort)) {
    throw new Error(
      `Modèle importé « ${model.id} » : effort par défaut « ${model.defaultReasoningEffort} » hors liste`
    )
  }
  return model
}

/** Retrouve un modèle importé par son id canonique. */
export function findModel(models: ImportedModel[], id: string): ImportedModel | undefined {
  return models.find((m) => m.id === id)
}

/** Premier modèle importé d'un provider donné (pour une migration/défaut sûr). */
export function defaultModelForProvider(
  models: ImportedModel[],
  provider: string
): ImportedModel | undefined {
  return models.find((m) => m.provider === provider)
}

/**
 * Importe (ajoute ou remplace) un modèle dans la liste, immuablement.
 * Un id déjà présent est REMPLACÉ (import idempotent), jamais dupliqué.
 */
export function importModel(models: ImportedModel[], model: ImportedModel): ImportedModel[] {
  assertImportedModel(model)
  const rest = models.filter((m) => m.id !== model.id)
  return [...rest, { ...model, reasoningEfforts: [...model.reasoningEfforts] }]
}

/** Retire un modèle par id, immuablement. */
export function removeModel(models: ImportedModel[], id: string): ImportedModel[] {
  return models.filter((m) => m.id !== id)
}
