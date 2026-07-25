// Résolution DYNAMIQUE des modèles LLM (process main).
//
// Rôle du module :
//   (a) interroger les catalogues providers réellement exposés — via
//       `discoverImportedModels()` (models.ts), la SEULE voie de discovery,
//       jamais dupliquée ici — au démarrage + rafraîchissement périodique ou à
//       la demande (`refresh()`) ;
//   (b) offrir des ALIAS stables par famille (`opus-latest`, `sonnet-latest`,
//       `claude/haiku-latest`, `codex/gpt-latest`, …) résolus vers le modèle le
//       plus récent RÉELLEMENT présent dans le catalogue — aucun nom inventé :
//       si la famille n'existe pas dans le catalogue, l'alias ne résout pas ;
//   (c) persister la dernière liste connue (%APPDATA%\autowin-os\model-catalog.json)
//       et s'en servir en fallback quand une voie de discovery a échoué (la
//       discovery retombe alors sur son seed vérifié : on préfère le dernier
//       catalogue riche réellement observé pour ce provider) ;
//   (d) exposer `resolveAlias(alias)` → identifiant de transport (`model`)
//       consommable directement par un RoleBinding.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import {
  DEFAULT_IMPORTED_MODELS,
  discoverImportedModels,
  type ImportedModel
} from './models'
import { ensureAutowinAppData } from './app-data'

export const MODEL_CATALOG_FILE = 'model-catalog.json'
const DEFAULT_REFRESH_INTERVAL_MS = 30 * 60_000

interface PersistedCatalog {
  updatedAt: string
  models: ImportedModel[]
}

function defaultCatalogPath(): string {
  return join(ensureAutowinAppData(), MODEL_CATALOG_FILE)
}

function isImportedModel(value: unknown): value is ImportedModel {
  const m = value as ImportedModel
  return (
    !!m &&
    typeof m.id === 'string' &&
    typeof m.provider === 'string' &&
    typeof m.model === 'string' &&
    typeof m.label === 'string' &&
    Array.isArray(m.reasoningEfforts) &&
    typeof m.defaultReasoningEffort === 'string'
  )
}

export function loadPersistedCatalog(path = defaultCatalogPath()): ImportedModel[] | undefined {
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as PersistedCatalog
    const models = (parsed.models ?? []).filter(isImportedModel)
    return models.length > 0 ? models : undefined
  } catch {
    return undefined
  }
}

export function savePersistedCatalog(models: ImportedModel[], path = defaultCatalogPath()): void {
  mkdirSync(dirname(path), { recursive: true })
  const payload: PersistedCatalog = { updatedAt: new Date().toISOString(), models }
  writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8')
}

/** Ids du seed, par provider — sert à détecter « discovery retombée sur le seed ». */
function seedIdsForProvider(provider: string): Set<string> {
  return new Set(
    DEFAULT_IMPORTED_MODELS.filter((m) => m.provider === provider).map((m) => m.id)
  )
}

/**
 * La discovery (models.ts) ne jette jamais : une voie en échec retombe sur son
 * seed vérifié. Un résultat pour un provider est donc considéré « fallback »
 * quand il est un SOUS-ENSEMBLE du seed de ce provider. Dans ce cas, si le
 * catalogue persisté connaît un ensemble plus riche pour ce provider, on le
 * préfère (dernière liste RÉELLEMENT observée, jamais inventée).
 */
export function mergeWithPersisted(
  discovered: ImportedModel[],
  persisted: ImportedModel[] | undefined
): ImportedModel[] {
  if (!persisted || persisted.length === 0) return discovered
  const providers = new Set([...discovered, ...persisted].map((m) => m.provider))
  const merged: ImportedModel[] = []
  for (const provider of providers) {
    const fresh = discovered.filter((m) => m.provider === provider)
    const known = persisted.filter((m) => m.provider === provider)
    const seedIds = seedIdsForProvider(provider)
    const freshIsSeedFallback = fresh.length > 0 && fresh.every((m) => seedIds.has(m.id))
    const knownIsRicher =
      known.length > 0 && (known.length > fresh.length || known.some((m) => !seedIds.has(m.id)))
    merged.push(...(freshIsSeedFallback && knownIsRicher ? known : fresh.length > 0 ? fresh : known))
  }
  return merged
}

// ————— Aliases par famille —————

/** Familles reconnues par provider ; extraites du champ `model` (transport). */
const FAMILY_PATTERNS: Array<{ provider: string; family: string; test: RegExp }> = [
  { provider: 'claude', family: 'opus', test: /^claude-opus-/ },
  { provider: 'claude', family: 'sonnet', test: /^claude-sonnet-/ },
  { provider: 'claude', family: 'haiku', test: /^claude-haiku-/ },
  { provider: 'claude', family: 'fable', test: /^claude-fable-/ },
  { provider: 'codex', family: 'gpt', test: /^gpt-/ },
  { provider: 'kimi', family: 'kimi', test: /^kimi/ }
]

/**
 * Clé de récence d'un id de modèle : tous les groupes numériques, dans l'ordre
 * (versions puis date AAAAMMJJ éventuelle). Comparaison lexicographique de
 * tuples — suffisant au SEIN d'une même famille (claude-opus-4-6 > claude-opus-4-5 ;
 * …-20251001 départage deux snapshots).
 */
export function recencyKey(model: string): number[] {
  return (model.match(/\d+/g) ?? []).map((n) => Number(n))
}

function compareRecency(a: number[], b: number[]): number {
  const len = Math.max(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = (a[i] ?? -1) - (b[i] ?? -1)
    if (d !== 0) return d
  }
  return 0
}

export interface AliasResolution {
  alias: string
  model: ImportedModel
}

/**
 * Résout un alias de famille (`opus-latest` ou `claude/opus-latest`) vers le
 * modèle le plus récent réellement présent dans `models`. `undefined` si la
 * famille n'a aucun modèle dans le catalogue (on n'invente RIEN).
 */
export function resolveFamilyAlias(
  models: ImportedModel[],
  alias: string
): ImportedModel | undefined {
  const match = /^(?:([a-z0-9-]+)\/)?([a-z0-9.-]+)-latest$/.exec(alias.trim().toLowerCase())
  if (!match) return undefined
  const [, providerHint, family] = match
  const patterns = FAMILY_PATTERNS.filter(
    (p) => p.family === family && (!providerHint || p.provider === providerHint)
  )
  if (patterns.length === 0) return undefined
  const candidates = models.filter((m) =>
    patterns.some((p) => p.provider === m.provider && p.test.test(m.model))
  )
  if (candidates.length === 0) return undefined
  return candidates.reduce((best, next) =>
    compareRecency(recencyKey(next.model), recencyKey(best.model)) > 0 ? next : best
  )
}

/** Liste les alias résolubles sur un catalogue donné (introspection/UI). */
export function availableAliases(models: ImportedModel[]): AliasResolution[] {
  const out: AliasResolution[] = []
  for (const { provider, family } of FAMILY_PATTERNS) {
    const alias = `${provider}/${family}-latest`
    const model = resolveFamilyAlias(models, alias)
    if (model) out.push({ alias, model })
  }
  return out
}

// ————— Résolveur avec cycle de vie —————

export interface ModelResolverOptions {
  /** Injection de la discovery (tests) ; défaut = discoverImportedModels(fetch). */
  discover?: () => Promise<ImportedModel[]>
  /** Chemin du catalogue persisté ; défaut = %APPDATA%\autowin-os\model-catalog.json. */
  catalogPath?: string
  /** Période du rafraîchissement automatique ; défaut 30 min. */
  refreshIntervalMs?: number
  /** Notifié après chaque refresh réussi (re-sync topologie, etc.). */
  onCatalog?: (models: ImportedModel[]) => void
}

export class ModelResolver {
  private models: ImportedModel[]
  private readonly discover: () => Promise<ImportedModel[]>
  private readonly catalogPath: string
  private readonly refreshIntervalMs: number
  private readonly onCatalog?: (models: ImportedModel[]) => void
  private timer: NodeJS.Timeout | undefined

  constructor(opts: ModelResolverOptions = {}) {
    this.discover = opts.discover ?? (() => discoverImportedModels(fetch))
    this.catalogPath = opts.catalogPath ?? defaultCatalogPath()
    this.refreshIntervalMs = opts.refreshIntervalMs ?? DEFAULT_REFRESH_INTERVAL_MS
    this.onCatalog = opts.onCatalog
    // État initial : dernier catalogue persisté si présent, sinon seed vérifié.
    this.models = loadPersistedCatalog(this.catalogPath) ?? DEFAULT_IMPORTED_MODELS
  }

  /** Catalogue courant (dernier refresh, ou persisté/seed avant le premier). */
  getModels(): ImportedModel[] {
    return this.models
  }

  /** Discovery à la demande : interroge les providers, fusionne, persiste. */
  async refresh(): Promise<ImportedModel[]> {
    const discovered = await this.discover()
    this.models = mergeWithPersisted(discovered, loadPersistedCatalog(this.catalogPath))
    try {
      savePersistedCatalog(this.models, this.catalogPath)
    } catch {
      // Persistance best-effort : un disque en échec ne bloque pas la résolution.
    }
    this.onCatalog?.(this.models)
    return this.models
  }

  /** Démarre refresh initial + périodique. Retourne la promesse du 1er refresh. */
  start(): Promise<ImportedModel[]> {
    this.stop()
    this.timer = setInterval(() => {
      void this.refresh().catch(() => {})
    }, this.refreshIntervalMs)
    this.timer.unref?.()
    return this.refresh()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }

  /**
   * API interne pour les bindings de rôles : alias (`opus-latest`,
   * `claude/sonnet-latest`) → identifiant de transport (`model`) du modèle le
   * plus récent du catalogue. Un id non-alias déjà présent dans le catalogue
   * est renvoyé tel quel (pass-through). `undefined` = irrésoluble.
   */
  resolveAlias(alias: string): string | undefined {
    const byFamily = resolveFamilyAlias(this.models, alias)
    if (byFamily) return byFamily.model
    const direct = this.models.find((m) => m.id === alias || m.model === alias)
    return direct?.model
  }

  /** Variante riche : l'objet ImportedModel complet (provider, efforts…). */
  resolveAliasModel(alias: string): ImportedModel | undefined {
    return (
      resolveFamilyAlias(this.models, alias) ??
      this.models.find((m) => m.id === alias || m.model === alias)
    )
  }
}
