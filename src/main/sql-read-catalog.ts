// fix-ok: valeurs propres à entreprise (serveur, base, table, colonnes du catalogue) écrites en dur — mesuré par grep; remplacées par la config sql-catalog.json, fermée par défaut (tests sql-read-catalog/guard rouge si on rouvre)
/**
 * Catalogue des cibles SQL autorisées — la liste blanche, et son AUTORITÉ.
 *
 * POURQUOI CE MODULE EXISTE. Un périmètre défini par un motif de nom de base plus une liste de
 * serveurs écrite dans le code s'est révélé à la fois TROP LARGE (il ouvrait des maquettes et des
 * copies figées qui « ressemblaient » à des bases de production) et TROP ÉTROIT (un serveur oublié
 * rendait une base vivante injoignable). Aucune heuristique de nom ne tranche.
 *
 * L'autorité est donc une TABLE de catalogue, lue telle quelle : une colonne dit si la base est
 * exploitée, deux autres donnent le couple exact (base, serveur). Où vit cette table, et comment
 * s'appellent ses colonnes, dépend de chaque installation : c'est `sql-catalog.json` qui le dit.
 *
 * ATTENTION — UNE TELLE TABLE PEUT CONTENIR DES SECRETS (mots de passe, clés). D'où deux règles :
 *   1. la requête est construite depuis la configuration VALIDÉE et ne sélectionne que le nom de
 *      base et le serveur ;
 *   2. la base catalogue est lisible par l'agent, MAIS sous une garde dédiée (`sql-read-guard.ts`,
 *      `secretColumnViolation`) : `*` et toute colonne de mot de passe / clé sont refusés avant
 *      d'atteindre le serveur.
 */
import { existsSync, readFileSync } from 'node:fs'
import { runSqlcmdJson, type SqlcmdDeps } from './sqlcmd-runner'

export interface SqlTarget {
  server: string
  database: string
}

/**
 * CONFIGURATION DU CATALOGUE — plus aucune valeur d'entreprise dans le code. Le serveur, la base, la
 * table et les colonnes de l'autorité viennent d'un fichier propre à chaque utilisateur
 * (`<userData>/sql-catalog.json`, chargé au démarrage par `index.ts`). SANS configuration, le
 * catalogue est VIDE et marqué `degraded` : aucune base n'est lisible. Défaut FERMÉ.
 */
export interface SqlCatalogConfig {
  /** Serveur qui héberge la base catalogue (ex. `SRV\\INSTANCE`). */
  server: string
  /** Base catalogue — lisible par l'agent, colonnes secrètes exclues (`sql-read-guard.ts`). */
  database: string
  /** Table qui liste les bases de production (ex. `dbo.BASES`). */
  table: string
  /** Colonne du nom de base. */
  databaseColumn: string
  /** Colonne du serveur. */
  serverColumn: string
  /** Colonne booléenne : 1 = base exploitée (production). */
  exploitColumn: string
  /** Cibles de développement lisibles, hors autorité. */
  devTargets: SqlTarget[]
  /** Serveurs de développement dont TOUTES les bases sont lisibles. */
  devServers: string[]
}

const IDENT = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/
const TABLE = /^[A-Za-z_][A-Za-z0-9_]{0,127}(\.[A-Za-z_][A-Za-z0-9_]{0,127})?$/
const NOM_CIBLE = /^[A-Za-z0-9_\-\\.]{1,128}$/

const chaine = (v: unknown): string => (typeof v === 'string' ? v.trim() : '')

/**
 * Valide un fichier de configuration. Les identifiants entrent dans une requête SQL : ils sont
 * vérifiés par motif strict, jamais interpolés tels quels. Invalide → `undefined` (donc fermé).
 */
export function parseSqlCatalogConfig(value: unknown): SqlCatalogConfig | undefined {
  if (!value || typeof value !== 'object') return undefined
  const v = value as Record<string, unknown>
  const server = chaine(v.server)
  const database = chaine(v.database)
  const table = chaine(v.table)
  const databaseColumn = chaine(v.databaseColumn)
  const serverColumn = chaine(v.serverColumn)
  const exploitColumn = chaine(v.exploitColumn)
  if (!NOM_CIBLE.test(server) || !NOM_CIBLE.test(database) || !TABLE.test(table)) return undefined
  if (![databaseColumn, serverColumn, exploitColumn].every((c) => IDENT.test(c))) return undefined
  const devTargets: SqlTarget[] = []
  for (const t of Array.isArray(v.devTargets) ? v.devTargets : []) {
    const r = (t ?? {}) as Record<string, unknown>
    const s = chaine(r.server)
    const d = chaine(r.database)
    if (!NOM_CIBLE.test(s) || !NOM_CIBLE.test(d)) return undefined
    devTargets.push({ server: s, database: d })
  }
  const devServers: string[] = []
  for (const s of Array.isArray(v.devServers) ? v.devServers : []) {
    const n = chaine(s)
    if (!NOM_CIBLE.test(n)) return undefined
    devServers.push(n)
  }
  return { server, database, table, databaseColumn, serverColumn, exploitColumn, devTargets, devServers }
}

let configuration: SqlCatalogConfig | undefined

/**
 * Charge `sql-catalog.json`. Fichier absent, illisible ou invalide → aucune configuration (fermé).
 */
export function loadSqlCatalogConfigFile(path: string): SqlCatalogConfig | undefined {
  let config: SqlCatalogConfig | undefined
  try {
    if (existsSync(path)) config = parseSqlCatalogConfig(JSON.parse(readFileSync(path, 'utf8')))
  } catch {
    config = undefined
  }
  configureSqlCatalog(config)
  return config
}

/** Installe (ou retire, sans argument) la configuration. Vide le cache. */
export function configureSqlCatalog(config?: SqlCatalogConfig): void {
  configuration = config
  cache = undefined
}

export function getSqlCatalogConfig(): SqlCatalogConfig | undefined {
  return configuration
}

/** La base catalogue comme cible de lecture — `undefined` sans configuration. */
export function catalogTarget(): SqlTarget | undefined {
  return configuration ? { server: configuration.server, database: configuration.database } : undefined
}

/** La base visée est-elle la base catalogue configurée (celle qui porte les secrets) ? */
export function estBaseCatalogue(database: string | undefined): boolean {
  return (
    !!configuration &&
    typeof database === 'string' &&
    database.trim().toLowerCase() === configuration.database.toLowerCase()
  )
}

/**
 * Requête construite depuis la configuration validée, jamais influencée par l'agent, et minimale :
 * deux colonnes, aucune autre. La table peut porter des mots de passe — on n'en lit pas une de plus.
 */
export function buildCatalogQuery(c: SqlCatalogConfig): string {
  return [
    'SET NOCOUNT ON',
    `SELECT ${c.databaseColumn} AS d, ${c.serverColumn} AS s FROM ${c.table} WHERE ${c.exploitColumn} = 1 AND ${c.databaseColumn} IS NOT NULL AND ${c.serverColumn} IS NOT NULL FOR JSON PATH`
  ].join(';\n')
}

/** Cibles de développement configurées (vide sans configuration). */
export function devTargets(): readonly SqlTarget[] {
  return configuration?.devTargets ?? []
}

export function estServeurDev(server: string | undefined): boolean {
  if (typeof server !== 'string' || !configuration) return false
  const s = server.trim().toLowerCase()
  return configuration.devServers.some((d) => d.toLowerCase() === s)
}

export interface SqlTargetCatalog {
  /** Le couple (serveur, base) est-il autorisé ? Comparaison insensible à la casse. */
  has: (server: string, database: string) => boolean
  servers: () => string[]
  databasesFor: (server: string) => string[]
  size: () => number
  /**
   * `true` quand l'autorité n'a pas pu être lue : seules les cibles fixes de développement sont
   * disponibles. On le SIGNALE au lieu de retomber silencieusement sur un motif de nom — un périmètre
   * qui se dégrade sans le dire est exactement le défaut que les audits ont trouvé quatre fois.
   */
  degraded: boolean
}

const cle = (server: string, database: string): string =>
  `${server.trim().toLowerCase()}|${database.trim().toLowerCase()}`

export function buildSqlTargetCatalog(
  targets: readonly SqlTarget[],
  degraded = false
): SqlTargetCatalog {
  const index = new Map<string, SqlTarget>()
  for (const t of targets) {
    if (!t.server?.trim() || !t.database?.trim()) continue
    index.set(cle(t.server, t.database), { server: t.server.trim(), database: t.database.trim() })
  }
  return {
    has: (server, database) =>
      typeof server === 'string' &&
      typeof database === 'string' &&
      (index.has(cle(server, database)) || (estServeurDev(server) && database.trim().length > 0)),
    servers: () => [...new Set([...index.values()].map((t) => t.server))].sort(),
    databasesFor: (server) =>
      [...index.values()]
        .filter((t) => t.server.toLowerCase() === server.trim().toLowerCase())
        .map((t) => t.database)
        .sort(),
    size: () => index.size,
    degraded
  }
}

/** Traduit les lignes de l'autorité en cibles. Les lignes incomplètes sont ignorées, pas devinées. */
export function parseCatalogRows(rows: Record<string, unknown>[]): SqlTarget[] {
  const cibles: SqlTarget[] = []
  for (const row of rows) {
    const database = typeof row.d === 'string' ? row.d.trim() : ''
    const server = typeof row.s === 'string' ? row.s.trim() : ''
    if (database && server) cibles.push({ server, database })
  }
  return cibles
}

/** Durée de validité du catalogue en mémoire : un greffe n'entre pas en exploitation tous les jours. */
const CACHE_TTL_MS = 30 * 60 * 1000

interface CacheEntry {
  catalogue: SqlTargetCatalog
  expire: number
}
let cache: CacheEntry | undefined

/** Vide le cache. Utile aux tests, et à un rechargement explicite après mise en exploitation. */
export function clearSqlTargetCache(): void {
  cache = undefined
}

export interface CatalogDeps extends SqlcmdDeps {
  /** Horloge injectable : les tests ne doivent pas dépendre de l'heure réelle. */
  now?: () => number
}

/**
 * Rend le catalogue : les greffes exploités lus dans l'autorité, plus les cibles fixes de
 * développement. Si l'autorité est injoignable, le catalogue est marqué `degraded` et ne contient que
 * les cibles fixes — donc aucune base de production. Défaut FERMÉ, et visible.
 */
export async function resolveSqlTargets(deps: CatalogDeps = {}): Promise<SqlTargetCatalog> {
  const maintenant = (deps.now ?? Date.now)()
  if (cache && cache.expire > maintenant) return cache.catalogue

  const config = configuration
  if (!config) return buildSqlTargetCatalog([], true)
  const commun = { server: config.server, database: config.database }
  const resultat = await runSqlcmdJson(config.server, config.database, buildCatalogQuery(config), deps)
  const catalogue = resultat.ok
    ? buildSqlTargetCatalog([...parseCatalogRows(resultat.rows), commun, ...config.devTargets])
    : buildSqlTargetCatalog(config.devTargets, true)

  // Un catalogue dégradé n'est PAS mis en cache pour 30 minutes : on retentera au prochain appel,
  // sinon une panne réseau passagère priverait l'agent de la production une demi-heure.
  cache = { catalogue, expire: maintenant + (catalogue.degraded ? 0 : CACHE_TTL_MS) }
  return catalogue
}
