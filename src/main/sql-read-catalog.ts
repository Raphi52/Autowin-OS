/**
 * Catalogue des cibles SQL autorisées — la liste blanche, et son AUTORITÉ.
 *
 * POURQUOI CE MODULE EXISTE. La version précédente définissait le périmètre par un motif de nom
 * (`^RIG_…`) plus une liste de serveurs codée en dur. Deux défauts, tous deux constatés :
 *
 *  - TROP LARGE : le préfixe `RIG_` ne dit rien de l'exploitation. Il ouvrait des maquettes, des
 *    copies figées d'avant changement de structure et des bases de service. Aucune heuristique de nom
 *    ne pouvait trancher : `RIG_LE_PUY_MARTIN` ressemble à un greffe, et n'en est pas un.
 *  - TROP ÉTROITE : la liste des serveurs omettait `RIGBD-POLYNESIE`, qui héberge `RIG_PAPEETE` — un
 *    greffe VIVANT, donc injoignable par erreur.
 *
 * L'autorité n'était pas dans le code : elle est dans `COMMUN_RIG.dbo.GREFFE`, où `GRF_IS_EXPLOIT = 1`
 * désigne les greffes exploités, et où `GRF_NOMBASE_BD` / `GRF_SERVEUR_BD` donnent le couple exact.
 * On lit donc la vérité au lieu de la deviner. Mesuré le 2026-08-07 : 40 greffes exploités sur 4
 * serveurs, contre 274 lignes au total.
 *
 * ATTENTION — CETTE TABLE CONTIENT DES SECRETS : `GRF_PWD_BD`, `GRF_INFOGREFFE_PASSWORD`,
 * `GRF_DOCVERIF_PASSWORD`, `GRF_WS_IDNUM_CLEF_API`. D'où deux règles qui ne doivent pas bouger :
 *   1. la requête ci-dessous est FIXE et ne sélectionne que le nom de base et le serveur ;
 *   2. `COMMUN_RIG` n'est PAS dans le catalogue, donc l'agent ne peut pas la lire lui-même.
 */
import { runSqlcmdJson, type SqlcmdDeps } from './sqlcmd-runner'

export interface SqlTarget {
  server: string
  database: string
}

/** Où vit l'autorité. `COMMUN_RIG` n'est jamais une cible de lecture pour l'agent. */
export const CATALOG_SERVER = 'SQL-PROD\\PROD'
export const CATALOG_DATABASE = 'COMMUN_RIG'

/**
 * Requête FIXE, jamais influencée par l'agent, et volontairement minimale : deux colonnes, aucune
 * autre. La table voisine des mots de passe — on n'en lit pas une de plus que nécessaire.
 */
export const CATALOG_QUERY = [
  'SET NOCOUNT ON',
  'SELECT GRF_NOMBASE_BD AS d, GRF_SERVEUR_BD AS s FROM dbo.GREFFE WHERE GRF_IS_EXPLOIT = 1 AND GRF_NOMBASE_BD IS NOT NULL AND GRF_SERVEUR_BD IS NOT NULL FOR JSON PATH'
].join(';\n')

/**
 * Cibles de DÉVELOPPEMENT, demandées explicitement et absentes de l'autorité (elles sont
 * `GRF_IS_EXPLOIT = 0`, ce qui est normal : ce ne sont pas des greffes exploités). Elles sont donc
 * énumérées ici, en clair, plutôt que d'affaiblir le critère `IS_EXPLOIT` pour les faire entrer.
 * Noms vérifiés dans `COMMUN_RIG.dbo.GREFFE` le 2026-08-07 : `RIG_RECETTE`, et non `RIG_RECETE`.
 */
export const DEV_TARGETS: readonly SqlTarget[] = [
  { server: 'SQL-DEV\\DEV', database: 'RIG_DEV' },
  { server: 'SQL-DEV\\DEV', database: 'RIG_RECETTE' }
]

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
      index.has(cle(server, database)),
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

  const resultat = await runSqlcmdJson(CATALOG_SERVER, CATALOG_DATABASE, CATALOG_QUERY, deps)
  const catalogue = resultat.ok
    ? buildSqlTargetCatalog([...parseCatalogRows(resultat.rows), ...DEV_TARGETS])
    : buildSqlTargetCatalog(DEV_TARGETS, true)

  // Un catalogue dégradé n'est PAS mis en cache pour 30 minutes : on retentera au prochain appel,
  // sinon une panne réseau passagère priverait l'agent de la production une demi-heure.
  cache = { catalogue, expire: maintenant + (catalogue.degraded ? 0 : CACHE_TTL_MS) }
  return catalogue
}
