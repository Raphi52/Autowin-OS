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
import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
const CLAUDE_CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1_000
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

interface ClaudeModelCache {
  savedAt: number
  models: string[]
}

interface DiscoverModelsOptions {
  /** Cache local durable du catalogue Claude publié par le bridge. */
  claudeCachePath?: string
}

function isClaudeModelId(value: unknown): value is string {
  return typeof value === 'string' && /^claude-[a-z0-9-]+$/.test(value)
}

function importedClaudeModel(model: string): ImportedModel {
  return {
    id: `claude/${model}`,
    provider: 'claude',
    model,
    label: labelClaudeModel(model),
    reasoningEfforts: [...CLAUDE_EFFORTS],
    defaultReasoningEffort: model.includes('haiku') ? 'medium' : 'high'
  }
}

function fallbackClaudeModels(): ImportedModel[] {
  return DEFAULT_IMPORTED_MODELS.filter((model) => model.provider === 'claude')
}

function mergeClaudeModels(discovered: string[]): ImportedModel[] {
  const seen = new Set<string>()
  return [...fallbackClaudeModels(), ...discovered.map(importedClaudeModel)].filter((model) => {
    if (seen.has(model.model)) return false
    seen.add(model.model)
    return true
  })
}

async function readClaudeCache(cachePath?: string): Promise<string[]> {
  if (!cachePath) return []
  try {
    const cache = JSON.parse(await readFile(cachePath, 'utf8')) as Partial<ClaudeModelCache>
    if (
      typeof cache.savedAt !== 'number' ||
      Date.now() - cache.savedAt < 0 ||
      Date.now() - cache.savedAt > CLAUDE_CACHE_MAX_AGE_MS ||
      !Array.isArray(cache.models)
    )
      return []
    return cache.models.filter(isClaudeModelId)
  } catch {
    return []
  }
}

async function writeClaudeCache(cachePath: string | undefined, models: string[]): Promise<void> {
  if (!cachePath) return
  try {
    await mkdir(dirname(cachePath), { recursive: true })
    await writeFile(cachePath, JSON.stringify({ savedAt: Date.now(), models }), 'utf8')
  } catch {
    // Le cache accélère la résilience ; une erreur disque ne doit pas masquer le catalogue live.
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
  options: DiscoverModelsOptions = {}
): Promise<ImportedModel[]> {
  const codexModels = await discoverCodexModels(fetchFn, loadTokensFn)
  const cachedClaudeModels = await readClaudeCache(options.claudeCachePath)
  try {
    const response = await fetchFn('http://127.0.0.1:8787/models', {
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok)
      return [
        ...codexModels,
        ...mergeClaudeModels(cachedClaudeModels),
        ...DEFAULT_IMPORTED_MODELS.filter((model) => model.provider === 'kimi')
      ]
    const payload = (await response.json()) as { data?: Array<{ id?: unknown }> }
    const discovered = (payload.data ?? [])
      .map((entry) => entry.id)
      .filter(isClaudeModelId)
    if (discovered.length > 0) await writeClaudeCache(options.claudeCachePath, discovered)
    return [
      ...codexModels,
      ...mergeClaudeModels(discovered.length > 0 ? discovered : cachedClaudeModels),
      ...DEFAULT_IMPORTED_MODELS.filter((model) => model.provider === 'kimi')
    ]
  } catch {
    return [
      ...codexModels,
      ...mergeClaudeModels(cachedClaudeModels),
      ...DEFAULT_IMPORTED_MODELS.filter((model) => model.provider === 'kimi')
    ]
  }
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
