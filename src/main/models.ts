// Source CANONIQUE des modèles réellement disponibles dans Autowin OS.
//
// Un « modèle importé » est un objet de première classe : c'est LUI qu'on
// glisse sur un slot de topologie (orchestrateur / sous-agent / scout / judge).
// La liste est BORNÉE par ce que les adaptateurs providers savent réellement
// piloter — on n'invente jamais un modèle qui n'existe pas. Le seed par défaut
// reflète les voies vérifiées (catalogue du compte ChatGPT ; Claude CLI → alias
// --model réels) et l'utilisateur peut importer/supprimer explicitement.

import type { ReasoningEffort } from './roles'
import type { ComputeBinding } from '../shared/compute-fabric'
import { loadTokens, type Tokens } from './providers/codex-auth'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

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
  /** Contrat vérifié d'une ressource Fabric ; absent pour les providers locaux historiques. */
  compute?: ComputeBinding
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

/** Dernier catalogue valide : uniquement Codex/Claude, jamais les providers non concernés. */
export interface ModelCatalogCache {
  load(): ImportedModel[]
  save(models: ImportedModel[]): void
}

export class DiskModelCatalogCache implements ModelCatalogCache {
  constructor(private readonly path: string) {}

  load(): ImportedModel[] {
    if (!existsSync(this.path)) return []
    try {
      const parsed = JSON.parse(readFileSync(this.path, 'utf8')) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed.filter(isCachedModel)
    } catch {
      return []
    }
  }

  save(models: ImportedModel[]): void {
    const safe = models.filter(isCachedModel)
    mkdirSync(dirname(this.path), { recursive: true })
    const temporary = `${this.path}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(safe, null, 2), 'utf8')
    renameSync(temporary, this.path)
  }
}

function isCachedModel(value: unknown): value is ImportedModel {
  if (!value || typeof value !== 'object') return false
  const model = value as Partial<ImportedModel>
  return (
    (model.provider === 'codex' || model.provider === 'claude') &&
    typeof model.id === 'string' &&
    model.id === `${model.provider}/${model.model}` &&
    typeof model.model === 'string' &&
    /^[a-z0-9][a-z0-9.-]*$/.test(model.model) &&
    typeof model.label === 'string' &&
    Array.isArray(model.reasoningEfforts) &&
    model.reasoningEfforts.length > 0 &&
    model.reasoningEfforts.every((effort) => REASONING_EFFORTS.has(effort)) &&
    typeof model.defaultReasoningEffort === 'string' &&
    model.reasoningEfforts.includes(model.defaultReasoningEffort)
  )
}

function cachedOrSeed(provider: 'codex' | 'claude', cache: ModelCatalogCache): ImportedModel[] {
  const cached = cache.load().filter((model) => model.provider === provider)
  return cached.length > 0
    ? cached
    : DEFAULT_IMPORTED_MODELS.filter((model) => model.provider === provider)
}

async function discoverCodexModels(
  fetchFn: typeof fetch,
  loadTokensFn: () => Tokens | null,
  cache: ModelCatalogCache
): Promise<ImportedModel[]> {
  const tokens = loadTokensFn()
  if (!tokens) return cachedOrSeed('codex', cache)
  try {
    const response = await fetchFn(CODEX_MODELS_URL, {
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        originator: 'codex_cli_rs',
        'User-Agent': 'codex_cli_rs/0.0.0 (autowin-os)'
      },
      signal: AbortSignal.timeout(4_000)
    })
    if (!response.ok) return cachedOrSeed('codex', cache)
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
    return discovered.length > 0 ? discovered : cachedOrSeed('codex', cache)
  } catch {
    return cachedOrSeed('codex', cache)
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
  cache: ModelCatalogCache = { load: () => [], save: () => undefined }
): Promise<ImportedModel[]> {
  const cachedModels = cache.load()
  const codexModels = await discoverCodexModels(fetchFn, loadTokensFn, cache)
  let claudeModels = cachedOrSeed('claude', cache)
  try {
    const response = await fetchFn('http://127.0.0.1:8787/models', {
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) {
      saveCatalogIfChanged(cache, cachedModels, [...codexModels, ...claudeModels])
      return withLatestAliases(codexModels, claudeModels)
    }
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
    if (discovered.length > 0) claudeModels = discovered
  } catch {
    // Le cache/seed par provider est d\u00e9j\u00e0 choisi ; aucun autre provider n'est modifi\u00e9.
  }
  saveCatalogIfChanged(cache, cachedModels, [...codexModels, ...claudeModels])
  return withLatestAliases(codexModels, claudeModels)
}

function saveCatalogIfChanged(
  cache: ModelCatalogCache,
  cachedModels: ImportedModel[],
  nextModels: ImportedModel[]
): void {
  if (JSON.stringify(cachedModels) !== JSON.stringify(nextModels)) cache.save(nextModels)
}

function withLatestAliases(
  codexModels: ImportedModel[],
  claudeModels: ImportedModel[]
): ImportedModel[] {
  const aliases = [codexModels, claudeModels].flatMap((models) => {
    const latest = models
      .slice()
      .sort((a, b) => compareVersion(a.model, b.model))
      .at(-1)
    return latest
      ? [{ ...latest, id: `${latest.provider}/latest`, label: `${latest.label} · latest` }]
      : []
  })
  return [
    ...codexModels,
    ...claudeModels,
    ...aliases,
    ...DEFAULT_IMPORTED_MODELS.filter((model) => model.provider === 'kimi')
  ]
}

function compareVersion(left: string, right: string): number {
  const leftParts = left.match(/\d+|[a-z]+/g) ?? []
  const rightParts = right.match(/\d+|[a-z]+/g) ?? []
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const a = leftParts[index] ?? ''
    const b = rightParts[index] ?? ''
    if (a === b) continue
    const aNumber = /^\d+$/.test(a)
    const bNumber = /^\d+$/.test(b)
    if (aNumber && bNumber) return Number(a) - Number(b)
    return a.localeCompare(b)
  }
  return 0
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
