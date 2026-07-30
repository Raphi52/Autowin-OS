// Source CANONIQUE des modèles réellement disponibles dans Autowin OS.
//
// Un « modèle importé » est un objet de première classe : c'est LUI qu'on
// glisse sur un slot de topologie (orchestrateur / sous-agent / scout / judge).
// La liste est BORNÉE par ce que les adaptateurs providers savent réellement
// piloter — on n'invente jamais un modèle qui n'existe pas.
//
// D'où viennent les modèles, depuis le 2026-07-30 : UNIQUEMENT d'une source vivante ou d'un cache
// RÉELLEMENT observé sur cette machine. Plus aucun catalogue figé dans le code pour `claude` et
// `codex` — il devenait faux à chaque publication de modèle et l'affirmait en silence. Si la source
// ne répond pas, la liste est VIDE : une liste vide se voit et se répare, une liste périmée se croit.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import type { ReasoningEffort } from './roles'
import type { ComputeBinding } from '../shared/compute-fabric'
import { CODEX_VALID_EFFORTS } from './providers/codex'
import { isKnownAlias, parseClaudeVersion, resolveAlias } from './model-aliases'
import { listCodexAppServerModels, type CodexAppServerModel } from './codex-model-source'

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
  /** Rang curé du catalogue codex (asc = flagship en premier) ; absent hors listing live. */
  priority?: number
  /** Visibilité codex ('list' | 'hide' | …) telle qu'exposée par le listing live. */
  visibility?: string
}

/**
 * Déclarations de capacité des adaptateurs SANS source dynamique. Ce n'est PAS un repli.
 *
 * `kimi` et `gemini` n'ont aucun listing distant : ces entrées décrivent ce que
 * `providers/kimi.ts` et `providers/gemini.ts` savent réellement piloter. Il n'existe donc aucun
 * catalogue dont elles pourraient dériver, rien qui puisse mentir.
 *
 * `claude` et `codex` n'ont PLUS d'entrée ici, volontairement. Ils ont, eux, une source vivante
 * (service de modèles local pour Claude, App Server pour codex) — et une copie figée dans le code
 * devient fausse dès qu'un modèle est publié, en l'affirmant sans le moindre signal. Constaté le
 * 2026-07-30 : sur un poste sans le service, Agent Studio annonçait `opus-4-6` comme meilleur opus
 * alors que le service en exposait onze, dont `claude-opus-5`.
 */
export const DEFAULT_IMPORTED_MODELS: ImportedModel[] = [
  {
    // Alias officiel Kimi Code pour les comptes OAuth (pas une clé API).
    // Le CLI sélectionne ensuite le modèle effectivement autorisé par le compte.
    id: 'kimi/kimi-code/kimi-for-coding',
    provider: 'kimi',
    model: 'kimi-code/kimi-for-coding',
    label: 'Kimi Code · compte OAuth',
    reasoningEfforts: ['none'],
    defaultReasoningEffort: 'none'
  },
  {
    // Modèles réellement exposés par Antigravity 1.1.4 au compte Google local.
    id: 'gemini/Gemini 3.5 Flash (Low)',
    provider: 'gemini',
    model: 'Gemini 3.5 Flash (Low)',
    label: 'Gemini 3.5 Flash · Low',
    reasoningEfforts: ['none'],
    defaultReasoningEffort: 'none'
  },
  {
    id: 'gemini/Gemini 3.5 Flash (Medium)',
    provider: 'gemini',
    model: 'Gemini 3.5 Flash (Medium)',
    label: 'Gemini 3.5 Flash · Medium',
    reasoningEfforts: ['none'],
    defaultReasoningEffort: 'none'
  },
  {
    id: 'gemini/Gemini 3.5 Flash (High)',
    provider: 'gemini',
    model: 'Gemini 3.5 Flash (High)',
    label: 'Gemini 3.5 Flash · High',
    reasoningEfforts: ['none'],
    defaultReasoningEffort: 'none'
  },
  {
    id: 'gemini/Gemini 3.1 Pro (Low)',
    provider: 'gemini',
    model: 'Gemini 3.1 Pro (Low)',
    label: 'Gemini 3.1 Pro · Low',
    reasoningEfforts: ['none'],
    defaultReasoningEffort: 'none'
  },
  {
    id: 'gemini/Gemini 3.1 Pro (High)',
    provider: 'gemini',
    model: 'Gemini 3.1 Pro (High)',
    label: 'Gemini 3.1 Pro · High',
    reasoningEfforts: ['none'],
    defaultReasoningEffort: 'none'
  }
]

const CLAUDE_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
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

/** Résultat par voie : `live` distingue un listing réussi d'un repli (cache/seed). */
interface DiscoveryResult {
  models: ImportedModel[]
  live: boolean
}

async function discoverCodexModels(
  listModelsFn: () => Promise<CodexAppServerModel[]>
): Promise<DiscoveryResult> {
  // Meme regle que pour Claude : aucun modele codex INVENTE quand le listing live ne repond pas. Le
  // repli precedent (`DEFAULT_IMPORTED_MODELS[0]`) proposait UN modele fige, donc un id qui pouvait
  // avoir disparu du compte — l'UI le presentait comme utilisable et la requete echouait plus tard.
  const fallback: DiscoveryResult = { models: [], live: false }
  try {
    const payload = await listModelsFn()
    const discovered = payload.flatMap<ImportedModel>((entry, priority) => {
      if (typeof entry.model !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(entry.model)) return []
      // Filtre au set RÉELLEMENT accepté par /responses codex (live 2026-07-24 : minimal & ultra → 400).
      // Sinon l'UI proposerait un effort qui fait planter la requête (le bug ChatGPT HTTP 400).
      const efforts = (entry.supportedReasoningEfforts ?? [])
        .map((level) => level.reasoningEffort)
        .filter(
          (effort): effort is ReasoningEffort =>
            typeof effort === 'string' &&
            REASONING_EFFORTS.has(effort as ReasoningEffort) &&
            CODEX_VALID_EFFORTS.has(effort)
        )
      if (efforts.length === 0) return []
      const requestedDefault = entry.defaultReasoningEffort
      const defaultReasoningEffort =
        typeof requestedDefault === 'string' &&
        efforts.includes(requestedDefault as ReasoningEffort)
          ? (requestedDefault as ReasoningEffort)
          : efforts[0]
      return [
        {
          id: `codex/${entry.model}`,
          provider: 'codex',
          model: entry.model,
          label: `${entry.displayName || entry.model} · ChatGPT`,
          reasoningEfforts: efforts,
          defaultReasoningEffort,
          priority,
          visibility: entry.hidden ? 'hide' : 'list'
        }
      ]
    })
    return discovered.length > 0 ? { models: discovered, live: true } : fallback
  } catch {
    return fallback
  }
}

function labelClaudeModel(id: string): string {
  const version = parseClaudeVersion(id)
  if (!version) return `${id} · CLI`
  const name = version.family.charAt(0).toUpperCase() + version.family.slice(1)
  return `Claude ${name} ${version.major}${version.minor ? `.${version.minor}` : ''}${version.date ? ` (${version.date})` : ''} · CLI`
}

/** Conserve les seeds vérifiés tout en ajoutant les modèles découverts, sans doublon. */
function uniqueModels(discovered: ImportedModel[]): ImportedModel[] {
  const seen = new Set<string>()
  return discovered.filter((model) => {
    if (seen.has(model.model)) return false
    seen.add(model.model)
    return true
  })
}

async function discoverClaudeModels(fetchFn: typeof fetch): Promise<DiscoveryResult> {
  // PLUS DE REPLI STATIQUE. La liste Claude vit dans le service de modeles ; une copie figee dans le
  // code MENT des qu'Anthropic publie un modele. Constate le 2026-07-30 : sur un poste sans ce service,
  // Agent Studio affichait `opus-4-6` comme etant le meilleur opus disponible, alors que le service
  // en expose ONZE dont `claude-opus-5`. L'utilisateur ne voyait aucune erreur — juste une liste fausse
  // presentee comme la verite. Rendre la liste VIDE et l'indisponibilite VISIBLE est moins nuisible
  // qu'un mensonge silencieux : au moins on sait qu'il faut demarrer le service.
  const fallback: DiscoveryResult = { models: [], live: false }
  try {
    const response = await fetchFn('http://127.0.0.1:8787/models', {
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) return fallback
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
    return discovered.length > 0 ? { models: discovered, live: true } : fallback
  } catch {
    return fallback
  }
}

/**
 * Cache disque du DERNIER catalogue vu par voie — repli plus frais que le seed
 * figé quand une API de listing est KO. Écrit à chaque listing RÉUSSI ; jamais
 * écrit depuis un repli (le cache ne se pollue pas lui-même).
 */
interface ModelCatalogCache {
  version: 1
  discoveredAt: number
  claude?: ImportedModel[]
  codex?: ImportedModel[]
}

const MODEL_CATALOG_CACHE_VERSION = 1

function isValidCachedModel(model: unknown, provider: 'claude' | 'codex'): model is ImportedModel {
  if (!model || typeof model !== 'object') return false
  const candidate = model as Partial<ImportedModel>
  const validTransport =
    provider === 'claude'
      ? typeof candidate.model === 'string' && /^claude-[a-z0-9-]+$/.test(candidate.model)
      : typeof candidate.model === 'string' && /^[a-z0-9][a-z0-9.-]*$/.test(candidate.model)
  return (
    candidate.provider === provider &&
    validTransport &&
    candidate.id === `${provider}/${candidate.model}` &&
    typeof candidate.label === 'string' &&
    candidate.label.trim().length > 0 &&
    Array.isArray(candidate.reasoningEfforts) &&
    candidate.reasoningEfforts.length > 0 &&
    candidate.reasoningEfforts.every(
      (effort) => typeof effort === 'string' && REASONING_EFFORTS.has(effort as ReasoningEffort)
    ) &&
    typeof candidate.defaultReasoningEffort === 'string' &&
    candidate.reasoningEfforts.includes(candidate.defaultReasoningEffort as ReasoningEffort)
  )
}

function readCatalogCache(
  cachePath: string | undefined,
  provider: 'claude' | 'codex'
): ImportedModel[] | undefined {
  if (!cachePath) return undefined
  try {
    const cache = JSON.parse(readFileSync(cachePath, 'utf8')) as ModelCatalogCache
    if (cache.version !== MODEL_CATALOG_CACHE_VERSION || !Number.isFinite(cache.discoveredAt))
      return undefined
    const models = cache[provider]
    if (!Array.isArray(models)) return undefined
    // Garde d'intégrité minimale : on ne restitue que des entrées au contrat attendu.
    if (!models.every((model) => isValidCachedModel(model, provider))) return undefined
    return uniqueModels(models)
  } catch {
    return undefined
  }
}

function writeCatalogCache(
  cachePath: string | undefined,
  updates: Partial<ModelCatalogCache>
): void {
  if (!cachePath || Object.keys(updates).length === 0) return
  try {
    let existing: Partial<ModelCatalogCache> = {}
    try {
      const parsed = JSON.parse(readFileSync(cachePath, 'utf8')) as ModelCatalogCache
      if (parsed.version === MODEL_CATALOG_CACHE_VERSION && Number.isFinite(parsed.discoveredAt))
        existing = parsed
    } catch {
      // Pas de cache antérieur lisible : on repart d'un objet vide.
    }
    mkdirSync(dirname(cachePath), { recursive: true })
    const next: ModelCatalogCache = {
      ...existing,
      ...updates,
      version: MODEL_CATALOG_CACHE_VERSION,
      discoveredAt: Date.now()
    }
    const temporary = `${cachePath}.${process.pid}.tmp`
    writeFileSync(temporary, JSON.stringify(next, null, 2), 'utf8')
    renameSync(temporary, cachePath)
  } catch {
    // Le cache est un confort : son échec d'écriture ne doit jamais casser la découverte.
  }
}

/**
 * Catalogue disponible AVANT le réseau : uniquement ce qui a été RÉELLEMENT observé sur cette machine.
 *
 * Le cache est une source légitime — il contient un listing live d'une session précédente, pas une
 * liste inventée. En son absence on ne rend RIEN pour codex et claude : un seed figé dans le code
 * devient faux dès qu'un modèle est publié, et il l'affirme sans le moindre signal (constaté le
 * 2026-07-30 : `opus-4-6` presenté comme le meilleur opus alors que le service en expose `opus-5`).
 *
 * `kimi` et `gemini` restent, et ce n'est PAS la même chose : aucune source dynamique n'existe pour
 * eux, leurs entrées sont la DÉCLARATION DE CAPACITÉ de leur adaptateur (`providers/kimi.ts`,
 * `providers/gemini.ts`) — il n'y a pas de catalogue distant dont elles pourraient dériver, donc rien
 * qui puisse mentir. Les retirer supprimerait deux providers fonctionnels.
 */
export function loadCachedImportedModels(cachePath: string): ImportedModel[] {
  const codex = readCatalogCache(cachePath, 'codex') ?? []
  const claude = readCatalogCache(cachePath, 'claude') ?? []
  return [
    ...codex,
    ...claude,
    ...DEFAULT_IMPORTED_MODELS.filter(
      (model) => model.provider === 'kimi' || model.provider === 'gemini'
    )
  ]
}

/**
 * Découvre indépendamment les catalogues ChatGPT et Claude/Fable réellement exposés.
 * Chaque listing réussi est persisté dans `cachePath` ; une voie KO retombe sur le
 * dernier catalogue vu (cache), puis sur son seed vérifié — sans inventer de noms.
 */
export async function discoverImportedModels(
  fetchFn: typeof fetch = fetch,
  cachePath?: string,
  listCodexModelsFn: () => Promise<CodexAppServerModel[]> = listCodexAppServerModels
): Promise<ImportedModel[]> {
  const [codex, claude] = await Promise.all([
    discoverCodexModels(listCodexModelsFn),
    discoverClaudeModels(fetchFn)
  ])
  const cacheUpdates: Partial<ModelCatalogCache> = {}
  if (codex.live) cacheUpdates.codex = codex.models
  if (claude.live) cacheUpdates.claude = claude.models
  writeCatalogCache(cachePath, cacheUpdates)
  const codexModels = codex.live
    ? codex.models
    : (readCatalogCache(cachePath, 'codex') ?? codex.models)
  const discoveredClaudeModels = claude.live
    ? claude.models
    : (readCatalogCache(cachePath, 'claude') ?? claude.models)
  return [
    ...codexModels,
    ...uniqueModels(discoveredClaudeModels),
    ...DEFAULT_IMPORTED_MODELS.filter(
      (model) => model.provider === 'kimi' || model.provider === 'gemini'
    )
  ]
}

/**
 * Retrouve un modèle importé par son id canonique, OU résout un alias de famille
 * (`claude/opus-latest`, `codex/flagship`) contre le catalogue courant. Migration
 * douce : les bindings existants (ids concrets) matchent en priorité et restent
 * intacts ; un binding alias se résout au runtime sans jamais inventer de modèle.
 */
export function findModel(models: ImportedModel[], id: string): ImportedModel | undefined {
  const exact = models.find((m) => m.id === id)
  if (exact) return exact
  if (isKnownAlias(id)) return resolveAlias(id, models)
  return undefined
}

/** Premier modèle importé d'un provider donné (pour une migration/défaut sûr). */
export function defaultModelForProvider(
  models: ImportedModel[],
  provider: string
): ImportedModel | undefined {
  return models.find((m) => m.provider === provider)
}
