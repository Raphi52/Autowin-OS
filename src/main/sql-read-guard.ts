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
 * Vues et fonctions système à portée SERVEUR : elles sont visibles depuis n'importe quelle base et
 * renseignent donc sur ce qui est HORS du périmètre annoncé (liste des bases, serveurs liés,
 * comptes). Les métadonnées de la base courante (`sys.tables`, `sys.columns`) restent autorisées :
 * elles sont utiles pour explorer un greffe et ne débordent pas.
 */
const SERVER_SCOPED_VIEWS = [
  'databases',
  'servers',
  'sql_logins',
  'server_principals',
  'server_permissions',
  'master_files',
  'credentials',
  'linked_logins',
  'endpoints',
  'login_token'
]

/**
 * Vues de COMPATIBILITÉ : elles vivent dans le schéma `sys` mais sont résolubles SANS qualification,
 * si bien que chercher `sys.<vue>` ne les voyait pas. Vérifié en réel le 2026-08-07 :
 * `SELECT name FROM sysdatabases` énumérait toutes les bases du serveur depuis une base greffe.
 * Cherchées ici en mot entier, préfixe `sys.` optionnel.
 */
const COMPAT_SERVER_VIEWS = [
  'sysdatabases',
  'sysservers',
  'syslogins',
  'sysremotelogins',
  'sysaltfiles',
  'sysprocesses',
  'sysfiles',
  'syscurconfigs',
  'sysconfigures'
]

/**
 * Fonctions et familles de vues qui renseignent HORS du greffe ciblé sans nommer aucune table :
 * `DB_NAME(5)` donne le nom d'une autre base, `SERVERPROPERTY` la machine, `SUSER_SNAME` le compte,
 * et les vues de gestion dynamique `dm_exec_*` exposent jusqu'au TEXTE des requêtes des autres
 * utilisateurs — donc des données d'autres bases. Toutes constatées passantes au 3ᵉ audit.
 *
 * LIMITE ASSUMÉE : `OBJECT_NAME`/`OBJECT_ID` restent autorisées, car leur usage à un seul argument
 * est le moyen normal d'explorer les métadonnées du greffe. Leur seconde forme peut nommer un objet
 * d'une autre base : fuite de NOMS d'objets, sans accès aux données. Compromis retenu sciemment.
 */
const SERVER_SCOPED_FUNCTIONS = [
  'db_name',
  'db_id',
  'serverproperty',
  'suser_sname',
  'suser_name',
  'suser_id',
  'suser_sid',
  'system_user',
  'fn_my_permissions',
  'fn_trace_gettable',
  'fn_xe_file_target_read_file',
  'fn_get_audit_file',
  'fn_virtualfilestats',
  'fn_servershareddrives'
]

/** Préfixes des vues de gestion dynamique : portée serveur, jamais nécessaires à une lecture métier. */
const DYNAMIC_MANAGEMENT_PREFIX = /\bdm_(?:exec|os|db|io|tran|resource|server|cluster|xe)_/

/**
 * Indices de verrouillage. Un indice de table est PRIORITAIRE sur le niveau d'isolation posé par
 * l'enveloppe : `WITH (TABLOCKX, HOLDLOCK)` prend un verrou exclusif de table, tenu jusqu'au
 * `ROLLBACK`. `SET LOCK_TIMEOUT` protège NOTRE session, pas les greffiers qui écrivent en face.
 * Aucune écriture, mais une base de greffe bloquée — précisément ce qu'on veut éviter.
 */
const LOCK_HINTS = [
  'tablockx',
  'tablock',
  'xlock',
  'updlock',
  'holdlock',
  'serializable',
  'repeatableread',
  'pagelock'
]

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
  // Bornes de transaction : sans elles, l'enveloppe `BEGIN TRANSACTION … ROLLBACK` était refermable
  // depuis la requête, ce qui rendait une écriture DÉFINITIVE (second audit du 2026-08-07).
  'commit',
  'rollback',
  'begin',
  'tran',
  'transaction',
  // `GO` n'est pas du T-SQL mais un séparateur de lots de sqlcmd : il sépare les instructions SANS
  // point-virgule, et `GO <n>` réexécute le lot n fois. Il est aussi refusé en début de ligne
  // ci-dessous ; ici on couvre le cas où il apparaît ailleurs.
  'go'
]

/**
 * Constructions qui écrivent sans mot-clé d'écriture. `NEXT VALUE FOR` incrémente une séquence, et
 * cet incrément n'est PAS annulé par un rollback : l'enveloppe ne le rattraperait pas.
 */
const SIDE_EFFECT_CONSTRUCTS: [RegExp, string][] = [
  [/\bnext\s+value\s+for\b/, 'NEXT VALUE FOR : l’incrément d’une séquence n’est pas annulable.']
]

/**
 * Le texte du lot est passé à `sqlcmd`, qui le traite LIGNE PAR LIGNE avant de l'envoyer au moteur.
 * Deux formes lui appartiennent et doivent être refusées ici :
 *
 *   - `GO` (éventuellement suivi d'un compteur) sépare les lots — donc les instructions — sans
 *     point-virgule, ce qui contournait entièrement la règle « une seule instruction » ;
 *   - une ligne commençant par `:` est une commande sqlcmd. `:!!` exécute une commande du système
 *     d'exploitation et `:r` exécute un script du disque : on sort de SQL, avec les droits du compte
 *     Windows. `-X`/`-x` sont passés à sqlcmd en complément, mais on ne s'en remet pas à eux seuls.
 */
const SQLCMD_DIRECTIVE = /^[ \t]*(?:go\b|:)/im

/**
 * Préfixes de procédures système, cherchés en DÉBUT DE JETON uniquement (`\b`). Les chercher en
 * SOUS-CHAÎNE — ce que faisait la version auditée — rejetait des colonnes de production réelles
 * (`R_ACTIVITESP_VALEUR`, `BDCRCX_BOITE_POSTALE_SP_X`, `MNTSP_ID_MNTSP`, vérifiées existantes dans
 * RIG_AMIENS) sans rien sécuriser de plus : `EXEC`/`EXECUTE` interdisent déjà l'appel de procédure.
 */
const PROCEDURE_PREFIXES = /\b(?:sp|xp)_/

export interface SqlReadArgs {
  server?: unknown
  database?: unknown
  query?: unknown
}

export type SqlReadDecision =
  | { allowed: true; server: RigSqlServer; database: string; query: string }
  | { allowed: false; reason: string }

/**
 * Neutralise TOUT ce qui est délimité en SQL, pour que l'analyse qui suit porte sur la même
 * structure que celle vue par SQL Server :
 *
 *   - `'…'`  littéral de chaîne, apostrophe doublée `''` échappée  → devient `''`
 *   - `[…]`  identifiant délimité, crochet doublé `]]` échappé     → devient `x`
 *   - `"…"`  identifiant délimité (QUOTED_IDENTIFIER est ON)       → devient `x`
 *
 * POURQUOI c'est correct de remplacer le contenu d'un identifiant : ce contenu est INERTE pour
 * SQL Server, il ne peut rien exécuter. `[a;b]` est un nom de colonne, pas deux instructions.
 *
 * POURQUOI c'était la faille (audit du 2026-08-07, note 8/100). La version précédente ne
 * connaissait que `'…'`. Une apostrophe placée dans un identifiant — `[x'a]` — désynchronisait le
 * suivi des littéraux : la garde croyait entrer dans une chaîne et perdait de vue la fin de la
 * requête, là où SQL Server ne lisait qu'un nom de colonne suivi d'autres instructions. Le
 * `COMMIT TRANSACTION` ainsi injecté refermait la transaction de l'enveloppe, si bien que
 * l'écriture suivante devenait DÉFINITIVE : les deux couches de défense tombaient ensemble.
 *
 * Rend `undefined` si un délimiteur n'est PAS fermé : on ne raisonne pas sur un texte dont on ne
 * connaît plus la structure, on refuse.
 *
 * DEUX SORTIES, parce que les deux analyses qui suivent ont des besoins opposés :
 *
 *   - `masked` sert à l'analyse de STRUCTURE (mots-clés, instructions, parties d'un nom). Le contenu
 *     des identifiants y est remplacé par un jeton neutre ENTOURÉ D'ESPACES. Les espaces sont
 *     essentiels : sans elles, `delete[T]` devenait `deletex` et `\bdelete\b` ne matchait plus — le
 *     remplacement masquait le mot-clé qu'on cherchait (régression relevée au second audit).
 *   - `named` sert à l'analyse des NOMS (vues système hors périmètre). Le contenu des identifiants y
 *     est CONSERVÉ, sinon `sys.[databases]` échappait à la liste des vues interdites.
 */
interface StrippedQuery {
  masked: string
  named: string
}

function stripDelimited(query: string): StrippedQuery | undefined {
  /** Fermeture attendue par délimiteur, et jeton neutre utilisé dans `masked`. */
  const delimiters: Record<string, { close: string; masked: string }> = {
    "'": { close: "'", masked: "''" },
    '[': { close: ']', masked: ' x ' },
    '"': { close: '"', masked: ' x ' }
  }

  let masked = ''
  let named = ''
  let i = 0
  while (i < query.length) {
    const open = query[i]
    const delim = delimiters[open]
    if (!delim) {
      masked += open
      named += open
      i += 1
      continue
    }
    // On avance jusqu'à la fermeture, en sautant le délimiteur doublé qui l'échappe.
    const debutContenu = i + 1
    i += 1
    let closed = false
    while (i < query.length) {
      if (query[i] === delim.close) {
        if (query[i + 1] === delim.close) {
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
    // Un RETOUR À LA LIGNE dans une région délimitée est refusé. Raison : `sqlcmd` découpe le texte
    // ligne par ligne, aveugle aux délimiteurs SQL, alors que l'analyse qui suit voit un seul jeton.
    // Un `GO` ou une commande `:` posés sur leur propre ligne DANS un identifiant ou un littéral
    // étaient donc invisibles ici et bien actifs là-bas (3ᵉ audit du 2026-08-07). Un nom de colonne
    // ou une valeur cherchée n'en contient jamais légitimement.
    if (/[\r\n]/.test(query.slice(debutContenu, i - 1))) return undefined
    masked += delim.masked
    // Le contenu d'un LITTÉRAL reste vidé : y chercher un nom d'objet n'aurait aucun sens, et le
    // garder ferait échouer une lecture légitime dont la valeur cherchée ressemble à un nom interdit.
    named += open === "'" ? "''" : ` ${query.slice(debutContenu, i - 1)} `
  }
  return { masked, named }
}

/**
 * Refuse tout nom d'objet qui sort de la base ciblée. La cible n'était validée que via l'option
 * `-d` de sqlcmd, or un nom qualifié traverse les bases : la garde promettait un périmètre qu'elle
 * ne tenait pas (audit du 2026-08-07).
 *
 * Deux formes distinctes :
 *   - trois parties ou plus (`base.schema.objet`, `serveur.base.schema.objet`, `base..objet`) : on
 *     sort de la base courante, voire du serveur par un serveur lié → refusé ;
 *   - deux parties, mais une vue système à portée SERVEUR (`sys.databases`) : le nom reste local
 *     alors que le CONTENU déborde → refusé aussi.
 *
 * Les deux formes du texte produites par `stripDelimited` sont nécessaires : le comptage des parties
 * se fait sur la forme masquée, la recherche des vues interdites sur la forme qui garde les noms.
 */
function outOfScopeName(masque: string, nomme: string): string | undefined {
  const ident = '[A-Za-z0-9_@#$]'
  // Comptage des parties sur `masque` : le contenu d'un identifiant peut contenir un point
  // (`[a.b]` est UN nom), qui compterait à tort comme un séparateur de parties.
  // ident . (ident éventuellement vide, pour la forme base..objet) . ident
  if (new RegExp(`${ident}+\\s*\\.\\s*${ident}*\\s*\\.\\s*${ident}`).test(masque)) {
    return 'Nom d’objet qualifié sur plusieurs bases : la lecture doit rester dans la base ciblée.'
  }
  // Recherche des vues interdites sur `nomme`, où le contenu des identifiants est conservé : sinon
  // `sys.[databases]` passait, le nom ayant été remplacé par un jeton neutre (second audit).
  for (const vue of SERVER_SCOPED_VIEWS) {
    if (new RegExp(`\\bsys\\s*\\.\\s*${vue}\\b`).test(nomme)) {
      return `Vue système à portée serveur interdite : « sys.${vue} » sort du périmètre du greffe.`
    }
  }
  // Vues de compatibilité : le préfixe `sys.` est OPTIONNEL, elles se résolvent sans qualification.
  for (const vue of COMPAT_SERVER_VIEWS) {
    if (new RegExp(`\\b(?:sys\\s*\\.\\s*)?${vue}\\b`).test(nomme)) {
      return `Vue système à portée serveur interdite : « ${vue} » sort du périmètre du greffe.`
    }
  }
  return undefined
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

  // Directives sqlcmd cherchées sur le texte BRUT, AVANT tout nettoyage : c'est exactement ce que
  // sqlcmd voit, et il est aveugle aux délimiteurs SQL. Le contrôle est refait plus bas sur le texte
  // nettoyé — on veut les deux, aucun des deux ne couvrant l'autre.
  if (SQLCMD_DIRECTIVE.test(query)) {
    return {
      allowed: false,
      reason: 'Directive sqlcmd interdite (GO ou commande « : ») : une seule instruction SQL.'
    }
  }

  const sansLitteraux = stripDelimited(query)
  if (sansLitteraux === undefined) {
    return {
      allowed: false,
      reason:
        'Littéral ou identifiant délimité mal formé : non fermé, ou contenant un retour à la ligne.'
    }
  }

  // Commentaires : ils servent à masquer la suite d'une requête. Refusés d'emblée.
  if (/--|\/\*|\*\//.test(sansLitteraux.masked)) {
    return { allowed: false, reason: 'Commentaires SQL interdits dans une requête de lecture.' }
  }
  // Point-virgule : une seule instruction, toujours. C'est ce qui interdit « SELECT 1; DELETE … ».
  if (sansLitteraux.masked.includes(';')) {
    return {
      allowed: false,
      reason: 'Une seule instruction autorisée : le point-virgule est interdit.'
    }
  }
  // Directives de sqlcmd : `GO` sépare les instructions SANS point-virgule, et une ligne `:` sort
  // carrément de SQL. Le contrôle est ici parce que sqlcmd les traite AVANT le moteur.
  if (SQLCMD_DIRECTIVE.test(sansLitteraux.masked)) {
    return {
      allowed: false,
      reason: 'Directive sqlcmd interdite (GO ou commande « : ») : une seule instruction SQL.'
    }
  }

  const normalise = sansLitteraux.masked.toLowerCase()
  if (!/^\s*(select|with)\b/.test(normalise)) {
    return { allowed: false, reason: 'Seules les lectures sont autorisées : commence par SELECT.' }
  }
  for (const mot of FORBIDDEN_KEYWORDS) {
    if (new RegExp(`\\b${mot}\\b`).test(normalise)) {
      return { allowed: false, reason: `Mot-clé interdit en lecture : « ${mot} ».` }
    }
  }
  if (PROCEDURE_PREFIXES.test(normalise)) {
    return { allowed: false, reason: 'Appel de procédure système interdit (préfixe sp_ / xp_).' }
  }
  for (const [motif, raison] of SIDE_EFFECT_CONSTRUCTS) {
    if (motif.test(normalise)) return { allowed: false, reason: raison }
  }
  for (const hint of LOCK_HINTS) {
    if (new RegExp(`\\b${hint}\\b`).test(normalise)) {
      return {
        allowed: false,
        reason: `Indice de verrouillage interdit : « ${hint} » bloquerait la base de production.`
      }
    }
  }
  for (const fonction of SERVER_SCOPED_FUNCTIONS) {
    if (new RegExp(`\\b${fonction}\\b`).test(normalise)) {
      return {
        allowed: false,
        reason: `Fonction à portée serveur interdite : « ${fonction} » sort du périmètre du greffe.`
      }
    }
  }
  if (DYNAMIC_MANAGEMENT_PREFIX.test(normalise)) {
    return {
      allowed: false,
      reason: 'Vues de gestion dynamique interdites : elles exposent l’activité de tout le serveur.'
    }
  }
  const horsPerimetre = outOfScopeName(normalise, sansLitteraux.named.toLowerCase())
  if (horsPerimetre) return { allowed: false, reason: horsPerimetre }
  // `SELECT … INTO nouvelle_table` crée une table : la clause est refusée à part, `into` seul étant
  // aussi utilisé par `INSERT INTO` (déjà bloqué) et par `BULK INSERT`.
  if (/\binto\b/.test(normalise)) {
    return { allowed: false, reason: 'Clause INTO interdite : elle créerait une table.' }
  }

  return { allowed: true, server: server as RigSqlServer, database, query }
}
