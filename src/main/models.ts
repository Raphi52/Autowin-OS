// Source CANONIQUE des modèles réellement disponibles dans Autowin OS.
//
// Un « modèle importé » est un objet de première classe : c'est LUI qu'on
// glisse sur un slot de topologie (orchestrateur / sous-agent / scout / judge).
// La liste est BORNÉE par ce que les adaptateurs providers savent réellement
// piloter — on n'invente jamais un modèle qui n'existe pas.
//
// D'où viennent les modèles, depuis le 2026-07-30 : JAMAIS d'une liste figée dans le code pour
// `claude` et `codex` — elle devenait fausse à chaque publication de modèle et l'affirmait en silence
// (un poste tiers voyait `opus-4-6` annoncé comme le meilleur opus, alors qu'Opus 5 existait).
//   claude → les alias du CLI (`opus`, `sonnet`…, résolus côté serveur) + les modèles NOMMÉS lus dans
//            le binaire du CLI installé + les versions d'un service local s'il y en a un.
//   codex  → le listing `model/list` du CLI Codex connecté, sinon le dernier catalogue vu en cache,
//            sinon rien. Facultatif : un poste sans ce CLI ne voit simplement aucun modèle ChatGPT.
// Kimi et Gemini sont retirés depuis le 2026-09-04 ; Codex est revenu le 2026-10-31 (conv-1414).
// Le CLI Claude est présent par construction : l'app le spawne pour tout appel Claude. C'est donc la
// source à la fois portable et exacte — aucun service tiers, aucun appel payé, jamais périmée.

import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs'
import { dirname } from 'node:path'
import { isReasoningEffort, type ReasoningEffort } from './roles'
import type { ComputeBinding } from '../shared/compute-fabric'
import {
  compareClaudeVersions,
  isKnownAlias,
  parseClaudeVersion,
  resolveAlias
} from './model-aliases'
import { claudeCliModelIds } from './claude-cli-catalog'
import { listCodexAppServerModels, type CodexAppServerModel } from './codex-model-source'
import { ROUTED_PROVIDERS, type RoutedProvider } from './routed-providers'
import { resolveClaudeBin } from './providers/claude'
import { CodexCliIntrouvable } from './providers/codex'

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
  /** Vrai uniquement quand l'entrée provient d'un catalogue découvert à l'exécution. */
  dynamicallyLoaded?: boolean
}

/**
 * Déclarations de capacité des adaptateurs SANS source dynamique. Ce n'est PAS un repli.
 *
 * VIDE depuis le retrait de Kimi et Gemini (2026-09-04). Cette liste ne portait que `kimi` et
 * `gemini`, les deux seules voies sans listing distant. Elles sont retirées du produit : plus
 * proposées au premier lancement, plus sondées, plus listées au catalogue.
 *
 * `claude` n'a jamais eu d'entrée ici, volontairement : il a une source vivante (service de modèles
 * local) — et une copie figée dans le code devient fausse dès qu'un modèle est publié, en
 * l'affirmant sans le moindre signal. Constaté le 2026-07-30 : sur un poste sans le service, Agent
 * Studio annonçait `opus-4-6` comme meilleur opus alors que le service en exposait onze.
 *
 * La constante SURVIT (plutôt que d'être supprimée) parce qu'elle est le point d'extension d'un
 * futur adaptateur sans listing, et qu'elle est déjà câblée chez ses appelants.
 */
export const DEFAULT_IMPORTED_MODELS: ImportedModel[] = []

const CLAUDE_EFFORTS: ReasoningEffort[] = ['low', 'medium', 'high', 'xhigh', 'max']
/** Résultat par voie : `live` distingue un listing réussi d'un repli (cache/seed). */
interface DiscoveryResult {
  models: ImportedModel[]
  live: boolean
  /**
   * Sous-ensemble a METTRE EN CACHE. Distinct de `models` parce que tout n'a pas a l'etre : les alias
   * du CLI et les ids lus dans son binaire sont disponibles LOCALEMENT en permanence, les cacher
   * n'apporte rien. Seul ce qui vient d'une source qui peut se taire (service local, App Server) merite
   * d'etre memorise pour survivre a son absence. Absent = `models` fait office.
   */
  cacheable?: ImportedModel[]
  /**
   * Le CLI de cette voie n'est PAS installé. Distinct d'un listing en panne : une panne passagère
   * retombe sur le dernier catalogue vu, un CLI absent ne propose RIEN — sinon un vieux cache
   * afficherait des modèles qu'aucun appel ne pourra servir sur ce poste.
   */
  cliAbsent?: boolean
}

/**
 * Catalogue ChatGPT : ce que le CLI connecté déclare pour CE compte, rien d'autre.
 *
 * Les modèles MASQUÉS sont écartés ici (`gpt-reserve`, `codex-auto-review`, mesuré le 2026-10-31) :
 * ce sont des modèles internes du CLI, et aucun écran ne lit `visibility`, ils seraient proposés
 * dans toutes les listes de choix.
 *
 * Les efforts sont ceux que le listing annonce pour ce modèle, sans filtre global : le filtre
 * `CODEX_VALID_EFFORTS` ne vaut que pour l'appel HTTP direct. Mesuré le 2026-10-31 avec le CLI
 * 0.166 : `gpt-5.6-terra` + `ultra` répond (code 0), alors que le filtre l'aurait retiré.
 */
async function discoverCodexModels(
  listModelsFn: () => Promise<CodexAppServerModel[]>
): Promise<DiscoveryResult> {
  try {
    const payload = await listModelsFn()
    const discovered = payload.flatMap<ImportedModel>((entry, priority) => {
      if (entry.hidden) return []
      if (typeof entry.model !== 'string' || !/^[a-z0-9][a-z0-9.-]*$/.test(entry.model)) return []
      const efforts = (entry.supportedReasoningEfforts ?? [])
        .map((level) => level.reasoningEffort)
        .filter(
          (effort): effort is ReasoningEffort =>
            typeof effort === 'string' && isReasoningEffort(effort)
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
          label: entry.displayName || entry.model,
          reasoningEfforts: efforts,
          defaultReasoningEffort,
          priority,
          visibility: 'list',
          dynamicallyLoaded: true
        }
      ]
    })
    return { models: discovered, live: discovered.length > 0 }
  } catch (error) {
    return { models: [], live: false, cliAbsent: error instanceof CodexCliIntrouvable }
  }
}

/**
 * Libelle d'un ALIAS de famille. DISTINCT du libelle du modele NOMME correspondant : sans cela, la
 * liste de choix affichait DEUX entrees portant exactement « Claude Fable 5 · CLI » (l'alias `fable`
 * et l'id `claude-fable-5`), impossibles a distinguer. L'alias dit ce qu'il EST : un pointeur qui suit
 * les publications, avec entre parentheses la version vers laquelle il pointe aujourd'hui.
 */
function labelClaudeAlias(family: string, latestModelId: string): string {
  const name = family.charAt(0).toUpperCase() + family.slice(1)
  const version = latestModelId ? parseClaudeVersion(latestModelId) : null
  if (!version) return `Claude ${name} · dernier`
  return `Claude ${name} · dernier (${version.major}${version.minor ? `.${version.minor}` : ''})`
}

/**
 * Nom affiché d'un modèle Claude NOMMÉ. Sans suffixe « · CLI » (retiré le 2026-10-11, conv-237 :
 * « C'est con que les noms de models contiennent CLI ») : tous les modèles Claude passent par le
 * CLI, le suffixe ne distinguait rien et allongeait chaque ligne des listes de choix.
 */
function labelClaudeModel(id: string): string {
  const version = parseClaudeVersion(id)
  if (!version) return id
  const name = version.family.charAt(0).toUpperCase() + version.family.slice(1)
  return `Claude ${name} ${version.major}${version.minor ? `.${version.minor}` : ''}${version.date ? ` (${version.date})` : ''}`
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

/**
 * Deuxieme filet de la liste de choix : DEUX entrees au meme libelle sont indistinguables a l'ecran,
 * meme si leurs ids diffèrent. On garde la PREMIERE (les alias passent avant les ids nommes).
 */
function uniqueLabels(models: ImportedModel[]): ImportedModel[] {
  const seen = new Set<string>()
  return models.filter((model) => {
    if (seen.has(model.label)) return false
    seen.add(model.label)
    return true
  })
}

/**
 * Alias OFFICIELS du CLI Claude. `claude --help` : « Provide an alias for the latest model (e.g.
 * 'fable', 'opus', or 'sonnet') ». Chacun resout COTE SERVEUR vers le dernier modele de sa famille.
 *
 * C'est la seule source a la fois portable et increvable, et c'est ce qui repare le cas constate le
 * 2026-07-30 : Agent Studio n'affichait pas Opus 5 sur un poste tiers. La cause n'etait pas qu'Opus 5
 * y etait indisponible — il l'etait parfaitement — mais que la liste venait d'un service PERSONNEL
 * (`claude-bridge/bridge.py` de Hermes, sur 127.0.0.1:8787, dans le %LOCALAPPDATA% d'UN utilisateur).
 * Un collegue sans ce projet perso ne pouvait rien voir de recent.
 *
 * MESURE (appel reel, 2026-07-30) : `claude -p --model opus --output-format json` rend
 * `modelUsage: { 'claude-opus-5': ... }`. L'alias suit donc les publications sans qu'on touche au code.
 *
 * Ce n'est pas « inventer un modele » : c'est declarer l'interface documentee du CLI, exactement comme
 * les entrees `kimi`/`gemini` declarent ce que leur adaptateur sait piloter. Si le CLI est absent,
 * aucun modele Claude ne fonctionne de toute facon — le catalogue n'est pas ce qui le dira.
 */
const CLAUDE_CLI_ALIASES = ['opus', 'sonnet', 'haiku', 'fable'] as const

function claudeAliasModels(candidates: ImportedModel[]): ImportedModel[] {
  return CLAUDE_CLI_ALIASES.map<ImportedModel>((family) => ({
    id: `claude/${family}`,
    provider: 'claude',
    model: family,
    label:
      candidates.reduce<ImportedModel | undefined>((latest, candidate) => {
        const version = parseClaudeVersion(candidate.model)
        if (!version || version.family !== family) return latest
        if (!latest) return candidate
        const latestVersion = parseClaudeVersion(latest.model)
        return latestVersion && compareClaudeVersions(version, latestVersion) <= 0
          ? latest
          : candidate
      }, undefined)?.model ?? '',
    reasoningEfforts: [...CLAUDE_EFFORTS],
    defaultReasoningEffort: family === 'haiku' ? 'medium' : 'high'
  })).map((alias) => ({ ...alias, label: labelClaudeAlias(alias.model, alias.label) }))
}

function resolveClaudeAliasLabels(models: ImportedModel[]): ImportedModel[] {
  const labels = new Map(
    claudeAliasModels(models).map((alias) => [alias.model, alias.label] as const)
  )
  return models.map((model) => {
    const label = model.provider === 'claude' ? labels.get(model.model) : undefined
    return label ? { ...model, label } : model
  })
}

/** Ids de modeles du CLI installe — injectable pour que les tests ne dependent PAS de la machine. */
export type ClaudeCliModelIdsFn = () => string[]

const realClaudeCliModelIds: ClaudeCliModelIdsFn = () => claudeCliModelIds(resolveClaudeBin())

async function discoverClaudeModels(
  fetchFn: typeof fetch,
  cliModelIds: ClaudeCliModelIdsFn = realClaudeCliModelIds
): Promise<DiscoveryResult> {
  // fix-ok: evolution demandee explicitement par l'utilisateur (« ca peut pas recuperer opus 5
  // dynamiquement ? »), sur une cause MESUREE et non supposee : le binaire du CLI installe contient
  // bien `claude-opus-5` (scan reel du 2026-07-30, 24 ids retenus en 300 ms). Ce n'est pas un fix
  // aveugle : la source de verite change, elle passe d'un service personnel au CLI lui-meme.
  //
  // TROIS COUCHES, de la plus portable a la plus optionnelle :
  //  1. les ALIAS du CLI — toujours la, resolus cote serveur vers le dernier modele ;
  //  2. les modeles NOMMES lus dans le binaire du CLI installe — c'est ce qui permet d'AFFICHER
  //     « Claude Opus 5 » au lieu d'un vague « dernier », sans service tiers ni appel paye. Le CLI est
  //     present par construction : l'app le spawne pour tout appel Claude ;
  //  3. les versions d'un service local s'il y en a un (facultatif, pour epingler).
  const fromCli = cliModelIds().map<ImportedModel>((model) => ({
    id: `claude/${model}`,
    provider: 'claude',
    model,
    label: labelClaudeModel(model),
    reasoningEfforts: [...CLAUDE_EFFORTS],
    defaultReasoningEffort: model.includes('haiku') ? 'medium' : 'high',
    dynamicallyLoaded: true
  }))
  const aliases = claudeAliasModels(fromCli)
  try {
    const response = await fetchFn('http://127.0.0.1:8787/models', {
      signal: AbortSignal.timeout(2_000)
    })
    if (!response.ok) {
      return { models: [...aliases, ...fromCli], live: true, cacheable: [] }
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
        defaultReasoningEffort: model.includes('haiku') ? 'medium' : 'high',
        dynamicallyLoaded: true
      }))
    // Alias, puis modeles NOMMES du CLI installe, puis versions d'un service local. `uniqueModels` en
    // aval dedoublonne : un id present a la fois dans le binaire et dans le service ne sort qu'une fois.
    // `live` est toujours vrai : alias et binaire sont le CLI lui-meme, pas une supposition.
    const discoveredAliases = claudeAliasModels([...fromCli, ...discovered])
    return {
      models: [...discoveredAliases, ...fromCli, ...discovered],
      live: true,
      cacheable: discovered
    }
  } catch {
    // Service local absent = cas NORMAL (c'etait un projet personnel). Les alias + le binaire du CLI
    // suffisent, et c'est exactement ce qui manquait au collegue qui ne voyait pas Opus 5.
    return { models: [...aliases, ...fromCli], live: true, cacheable: [] }
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
    candidate.reasoningEfforts.every((effort) => isReasoningEffort(effort)) &&
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
    // Tout ce qui entre dans ce cache vient d'un listing dynamique antérieur. Ce marquage migre
    // aussi les caches créés avant l'ajout explicite de cette provenance.
    // Le nom d'un modèle Claude se DÉDUIT de son id : il est recalculé ici plutôt que relu, sinon un
    // cache écrit avant un changement de libellé (ex. l'ancien suffixe « · CLI ») le ramènerait.
    return uniqueModels(
      models.map((model) => ({
        ...model,
        ...(provider === 'claude' ? { label: labelClaudeModel(model.model) } : {}),
        dynamicallyLoaded: true
      }))
    )
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
 * liste inventée. En son absence on ne rend RIEN pour claude : un seed figé dans le code
 * devient faux dès qu'un modèle est publié, et il l'affirme sans le moindre signal (constaté le
 * 2026-07-30 : `opus-4-6` presenté comme le meilleur opus alors que le service en expose `opus-5`).
 *
 * `kimi` et `gemini` ont été RETIRÉS : plus aucune entrée déclarée en dur ne subsiste pour eux, et
 * le filtre de sortie ci-dessous écarte ce qu'un cache antérieur au retrait contiendrait encore.
 */
export function loadCachedImportedModels(cachePath: string): ImportedModel[] {
  const claude = readCatalogCache(cachePath, 'claude') ?? []
  // Les entrées masquées ne viennent que d'un cache écrit avant le 2026-10-31 : le listing ne les
  // écrit plus, et aucun écran ne doit les proposer au démarrage.
  const codex = (readCatalogCache(cachePath, 'codex') ?? []).filter(
    (model) => model.visibility !== 'hide'
  )
  // FILTRE DE SORTIE, comme dans `discoverImportedModels` : le cache disque a été écrit AVANT le
  // retrait des moteurs et peut contenir des entrées Kimi ou Gemini. Le fichier n'est PAS réécrit :
  // les données anciennes restent lisibles pour l'historique.
  return [...claude, ...codex, ...DEFAULT_IMPORTED_MODELS].filter((model) =>
    ROUTED_PROVIDERS.includes(model.provider as RoutedProvider)
  )
}

/**
 * Découvre indépendamment les catalogues ChatGPT et Claude/Fable réellement exposés.
 * Chaque listing réussi est persisté dans `cachePath` ; une voie KO retombe sur le
 * dernier catalogue vu (cache), puis sur son seed vérifié — sans inventer de noms.
 */
export async function discoverImportedModels(
  fetchFn: typeof fetch = fetch,
  cachePath?: string,
  cliModelIds: ClaudeCliModelIdsFn = realClaudeCliModelIds,
  listCodexModelsFn: () => Promise<CodexAppServerModel[]> = listCodexAppServerModels
): Promise<ImportedModel[]> {
  const [claude, codex] = await Promise.all([
    discoverClaudeModels(fetchFn, cliModelIds),
    discoverCodexModels(listCodexModelsFn)
  ])
  const cacheUpdates: Partial<ModelCatalogCache> = {}
  if (codex.live) cacheUpdates.codex = codex.models
  // On ne met en cache que les VERSIONS reellement decouvertes, jamais les alias du CLI : ceux-ci sont
  // disponibles en permanence (contrat du CLI), les cacher n'apporte rien et polluerait le cache d'ids
  // qui ne sont pas des modeles mais des pointeurs vers « le dernier ».
  const claudeToCache = claude.cacheable ?? claude.models
  if (claude.live && claudeToCache.length > 0) cacheUpdates.claude = claudeToCache
  writeCatalogCache(cachePath, cacheUpdates)
  const codexModels = codex.live
    ? codex.models
    : codex.cliAbsent
      ? []
      : (readCatalogCache(cachePath, 'codex') ?? []).filter((m) => m.visibility !== 'hide')
  // Claude se compose en DEUX couches, et il fallait les separer : les alias du CLI (socle permanent,
  // jamais caches) et les versions EXACTES (live si un service repond, sinon le dernier catalogue vu).
  // Sans cette separation, `claude.live` etant desormais toujours vrai, le cache n'aurait plus jamais
  // ete relu — on aurait perdu les versions epinglees des qu'un service se taisait.
  // Ce que le CLI fournit (alias + binaire) est TOUJOURS la ; on n'y ajoute le cache que si la source
  // cachable s'est taue, sinon on dupliquerait ce que le service vient de rendre.
  const discoveredClaudeModels =
    claudeToCache.length > 0
      ? claude.models
      : [...claude.models, ...(readCatalogCache(cachePath, 'claude') ?? [])]
  const resolvedClaudeModels = resolveClaudeAliasLabels(uniqueModels(discoveredClaudeModels))
  // FILTRE DE SORTIE — le catalogue ne propose que des moteurs RÉELLEMENT routés. Gardé même si
  // plus aucune voie retirée n'est sondée : `DEFAULT_IMPORTED_MODELS` ou un futur ajout pourraient
  // réintroduire un moteur mort, et c'est ce filtre qui l'arrête.
  // Claude d'abord, ChatGPT ensuite : l'ordre voulu par l'utilisateur pour les listes de choix.
  return uniqueLabels(
    dropRedundantClaudeAliases([
      ...resolvedClaudeModels,
      ...codexModels,
      ...DEFAULT_IMPORTED_MODELS
    ]).filter((model) => ROUTED_PROVIDERS.includes(model.provider as RoutedProvider))
  )
}

/**
 * Retire les ALIAS de famille (`claude/opus`, `claude/fable`…) des qu'une VERSION NOMMEE de la meme
 * famille est presente : la liste de choix ne doit proposer que des modeles precis, l'app prenant
 * de toute facon la derniere version quand on ne l'epingle pas (demande utilisateur du 2026-09-09,
 * « enleve ceux avec ecrit (dernier), on met tout le temps les derniers »). L'alias SURVIT quand sa
 * famille n'a aucune version connue : c'est le filet du poste sans service ni ids lisibles.
 */
function dropRedundantClaudeAliases(models: ImportedModel[]): ImportedModel[] {
  const familiesWithVersion = new Set(
    models
      .map((model) => (model.provider === 'claude' ? parseClaudeVersion(model.model) : null))
      .filter((version): version is NonNullable<typeof version> => Boolean(version))
      .map((version) => version.family)
  )
  return models.filter(
    (model) =>
      !(
        model.provider === 'claude' &&
        (CLAUDE_CLI_ALIASES as readonly string[]).includes(model.model) &&
        familiesWithVersion.has(model.model)
      )
  )
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
  // Un binding pose sur l'ALIAS BRUT du CLI (`claude/opus`) doit continuer a resoudre meme quand
  // l'alias ne figure plus dans la liste de choix : il pointe vers la derniere version de sa famille.
  const rawAlias = /^claude\/([a-z]+)$/.exec(id)
  if (rawAlias && (CLAUDE_CLI_ALIASES as readonly string[]).includes(rawAlias[1])) {
    return resolveAlias(`claude/${rawAlias[1]}-latest`, models)
  }
  return undefined
}

// fix-ok: conv-955 — cause mesuree : l'orchestrateur ne voyait pas le catalogue des modeles (0 occurrence
// de `reasoningEfforts` ou `getCatalog` dans HEAD:src/main/orchestrator.ts), donc la regle d'effort par
// etape ne pouvait pas connaitre le plancher du modele.
/**
 * Les efforts que le modèle d'un binding déclare au catalogue — même résolution que
 * runtime-topology.ts (id canonique ou alias, puis couple fournisseur/modèle de transport).
 * `undefined` si le catalogue, le modèle ou l'entrée manquent : l'appelant ne doit rien en déduire.
 */
export function effortsDeclaresDuModele(
  catalogue: ImportedModel[] | undefined,
  provider: string,
  model: string | undefined
): readonly ReasoningEffort[] | undefined {
  if (!catalogue || !model) return undefined
  const entree =
    findModel(catalogue, model.includes('/') ? model : `${provider}/${model}`) ??
    catalogue.find((candidat) => candidat.provider === provider && candidat.model === model)
  return entree?.provider === provider ? entree.reasoningEfforts : undefined
}

/** Premier modèle importé d'un provider donné (pour une migration/défaut sûr). */
export function defaultModelForProvider(
  models: ImportedModel[],
  provider: string
): ImportedModel | undefined {
  return models.find((m) => m.provider === provider)
}
