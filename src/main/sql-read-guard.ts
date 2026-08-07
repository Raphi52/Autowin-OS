/**
 * Garde de LECTURE SQL sur les bases RIG — la première couche de défense, purement décisionnelle.
 *
 * POURQUOI ELLE EST AUSSI STRICTE. La connexion se fait en authentification Windows intégrée, donc
 * avec le compte de l'utilisateur. Mesuré sur le poste de référence (2026-08-06, base RIG_AMIENS) :
 *
 *   IS_SRVROLEMEMBER('sysadmin') = 0    IS_MEMBER('db_owner') = 0
 *   IS_MEMBER('db_datawriter')   = 1    DELETE = 1    UPDATE = 1
 *
 * Le compte PEUT écrire dans les bases de PRODUCTION des greffes. La protection ne peut donc pas
 * venir des droits SQL : elle doit être ici, avant que quoi que ce soit n'atteigne le serveur. Un
 * modèle qui se trompe de requête ne doit pas pouvoir modifier un greffe.
 *
 * DÉFENSE EN PROFONDEUR — ce module est la première couche, pas la seule. L'exécution ajoute une
 * transaction systématiquement annulée, un délai borné et un plafond de lignes. Mais on ne compte
 * jamais sur ces filets pour rattraper une requête qui n'aurait pas dû passer : une écriture annulée
 * a quand même pris des verrous sur une base de production.
 *
 * CHOIX ASSUMÉ, décidé par l'utilisateur le 2026-08-06 : le périmètre couvre TOUTES les tables des
 * bases RIG, pas seulement le paramétrage. Conséquence explicite : des données nominatives de greffe
 * peuvent entrer dans le contexte du modèle, donc quitter le poste. Ce n'est pas un oubli.
 */

/** Serveurs RIG connus et joignables — vérifiés le 2026-08-06 depuis le poste de référence. */
export const RIG_SQL_SERVERS = ['SQL-PROD\\PROD', 'RIGBD-ANTILLES', 'RIGBD-REUNION'] as const
export type RigSqlServer = (typeof RIG_SQL_SERVERS)[number]

/** Une requête plus longue n'est plus relisible par un humain, et sent l'accident. */
const MAX_QUERY_LENGTH = 4000

/**
 * Noms de base acceptés : `RIG_` suivi de lettres, chiffres et soulignés. Le nom part dans la ligne
 * de commande de `sqlcmd` (option `-d`) : tout ce qui pourrait y être interprété est refusé, et on
 * exige le préfixe pour rester dans le périmètre RIG (jamais `master`, `msdb`, ni un autre applicatif).
 */
const DATABASE_PATTERN = /^RIG_[A-Za-z0-9_]+$/

/**
 * Mots-clés qui ÉCRIVENT, modifient la structure, changent les droits ou sortent de la base. Testés
 * en frontière de mot (`\b`) sur la requête DÉBARRASSÉE de ses littéraux : « delete » cherché comme
 * valeur dans un libellé ne doit pas faire échouer une lecture légitime.
 */
const FORBIDDEN_KEYWORDS = [
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'drop',
  'alter',
  'create',
  'exec',
  'execute',
  'grant',
  'revoke',
  'deny',
  'backup',
  'restore',
  'shutdown',
  'openrowset',
  'opendatasource',
  'openquery',
  'bulk',
  'writetext',
  'updatetext',
  'reconfigure',
  'kill',
  'dbcc',
  'waitfor',
  'xp_',
  'sp_'
]

export interface SqlReadArgs {
  server?: unknown
  database?: unknown
  query?: unknown
}

export type SqlReadDecision =
  | { allowed: true; server: RigSqlServer; database: string; query: string }
  | { allowed: false; reason: string }

/**
 * Retire les littéraux de chaîne, en gérant l'apostrophe doublée de SQL (`'l''eau'`). Rend
 * `undefined` si un littéral n'est PAS fermé : on ne peut alors plus raisonner sur la requête, donc
 * on refuse plutôt que d'analyser un texte dont on ne connaît pas la structure.
 */
function stripLiterals(query: string): string | undefined {
  let out = ''
  let i = 0
  while (i < query.length) {
    const c = query[i]
    if (c !== "'") {
      out += c
      i += 1
      continue
    }
    // Début d'un littéral : on avance jusqu'à sa fermeture, en sautant les '' internes.
    i += 1
    let closed = false
    while (i < query.length) {
      if (query[i] === "'") {
        if (query[i + 1] === "'") {
          i += 2
          continue
        }
        i += 1
        closed = true
        break
      }
      i += 1
    }
    if (!closed) return undefined
    out += "''" // le littéral devient une coquille vide, sans son contenu
  }
  return out
}

/** Valide la cible et la requête. Ne throw jamais : un refus est un résultat à afficher. */
export function decideSqlRead(args: SqlReadArgs): SqlReadDecision {
  const server = typeof args?.server === 'string' ? args.server.trim() : ''
  if (!(RIG_SQL_SERVERS as readonly string[]).includes(server)) {
    return {
      allowed: false,
      reason: `Serveur non autorisé : « ${server} ». Serveurs RIG : ${RIG_SQL_SERVERS.join(', ')}.`
    }
  }

  const database = typeof args?.database === 'string' ? args.database.trim() : ''
  if (!DATABASE_PATTERN.test(database)) {
    return {
      allowed: false,
      reason: `Base non autorisée : « ${database} ». Attendu une base greffe RIG_… (ex. RIG_AMIENS).`
    }
  }

  const query = typeof args?.query === 'string' ? args.query.trim() : ''
  if (!query) return { allowed: false, reason: 'Requête vide.' }
  if (query.length > MAX_QUERY_LENGTH) {
    return { allowed: false, reason: `Requête trop longue (max ${MAX_QUERY_LENGTH} caractères).` }
  }

  const sansLitteraux = stripLiterals(query)
  if (sansLitteraux === undefined) {
    return { allowed: false, reason: 'Littéral de chaîne non fermé : requête refusée.' }
  }

  // Commentaires : ils servent à masquer la suite d'une requête. Refusés d'emblée.
  if (/--|\/\*|\*\//.test(sansLitteraux)) {
    return { allowed: false, reason: 'Commentaires SQL interdits dans une requête de lecture.' }
  }
  // Point-virgule : une seule instruction, toujours. C'est ce qui interdit « SELECT 1; DELETE … ».
  if (sansLitteraux.includes(';')) {
    return {
      allowed: false,
      reason: 'Une seule instruction autorisée : le point-virgule est interdit.'
    }
  }

  const normalise = sansLitteraux.toLowerCase()
  if (!/^\s*(select|with)\b/.test(normalise)) {
    return { allowed: false, reason: 'Seules les lectures sont autorisées : commence par SELECT.' }
  }
  for (const mot of FORBIDDEN_KEYWORDS) {
    // `xp_` et `sp_` sont des PRÉFIXES de procédures : on les cherche tels quels, pas en mot entier.
    const trouve = mot.endsWith('_')
      ? normalise.includes(mot)
      : new RegExp(`\\b${mot}\\b`).test(normalise)
    if (trouve) {
      return { allowed: false, reason: `Mot-clé interdit en lecture : « ${mot} ».` }
    }
  }
  // `SELECT … INTO nouvelle_table` crée une table : la clause est refusée à part, `into` seul étant
  // aussi utilisé par `INSERT INTO` (déjà bloqué) et par `BULK INSERT`.
  if (/\binto\b/.test(normalise)) {
    return { allowed: false, reason: 'Clause INTO interdite : elle créerait une table.' }
  }

  return { allowed: true, server: server as RigSqlServer, database, query }
}
