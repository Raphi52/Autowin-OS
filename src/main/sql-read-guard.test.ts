import { describe, expect, it } from 'vitest'
import { decideSqlRead, type SqlReadArgs } from './sql-read-guard'
import { buildSqlTargetCatalog } from './sql-read-catalog'

/**
 * GARDE DE LECTURE SQL — le maillon de sécurité de la consultation des bases RIG.
 *
 * Pourquoi il existe, et pourquoi il est aussi strict : la connexion se fait en authentification
 * Windows intégrée, donc avec le compte de l'utilisateur. Mesuré sur ce poste (2026-08-06) :
 *
 *   IS_SRVROLEMEMBER('sysadmin') = 0   IS_MEMBER('db_owner') = 0
 *   IS_MEMBER('db_datawriter')   = 1   DELETE = 1   UPDATE = 1
 *
 * Autrement dit le compte PEUT écrire dans les bases de production des greffes. La protection ne
 * peut donc PAS venir des droits : elle doit être ici, dans le code, avant que quoi que ce soit
 * n'atteigne le serveur. Un modèle qui se trompe de requête ne doit pas pouvoir modifier un greffe.
 *
 * Défense en profondeur : ce validateur est la PREMIÈRE couche. L'exécution ajoute une transaction
 * systématiquement annulée, un délai borné et un plafond de lignes — mais on ne compte pas sur elles
 * pour rattraper une requête qui n'aurait pas dû passer.
 */
/**
 * Catalogue de test, calqué sur la réalité mesurée le 2026-08-07 dans `COMMUN_RIG.dbo.GREFFE` :
 * 40 greffes exploités répartis sur 4 serveurs, plus les deux cibles fixes de développement.
 * On en garde un échantillon représentatif — dont `RIGBD-POLYNESIE`, que la liste codée en dur
 * précédente omettait alors qu'il héberge un greffe VIVANT.
 */
const CATALOGUE = buildSqlTargetCatalog([
  { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' },
  { server: 'SQL-PROD\\PROD', database: 'RIG_LYON' },
  { server: 'SQL-PROD\\PROD', database: 'RIG_LE_PUY' },
  { server: 'SQL-PROD\\PROD', database: 'RIG_GRENOBLE' },
  { server: 'SQL-PROD\\PROD', database: 'RIG_AURILLAC' },
  { server: 'RIGBD-ANTILLES', database: 'RIG_POINTE_A_PITRE' },
  { server: 'RIGBD-POLYNESIE', database: 'RIG_PAPEETE' },
  { server: 'RIGBD-REUNION', database: 'RIG_MAMOUDZOU' },
  { server: 'SQL-DEV\\DEV', database: 'RIG_DEV' },
  { server: 'SQL-DEV\\DEV', database: 'RIG_RECETTE' }
])

const decide = (args: SqlReadArgs): ReturnType<typeof decideSqlRead> =>
  decideSqlRead(args, CATALOGUE)

describe('decideSqlRead — seule une lecture unique passe', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('accepte un SELECT simple', () => {
    const d = decide({
      ...base,
      query: 'SELECT R_CODEEVENEM_VALEUR FROM CODE_EVENEMENT_RCS'
    })
    expect(d.allowed).toBe(true)
  })

  it('accepte un SELECT avec jointure, WHERE, ORDER BY et fonctions', () => {
    const d = decide({
      ...base,
      query:
        "SELECT TOP 10 a.x, COUNT(*) AS n FROM T a JOIN U b ON b.id = a.id WHERE a.v = 'MORCA' GROUP BY a.x HAVING COUNT(*) > 1 ORDER BY n DESC"
    })
    expect(d.allowed).toBe(true)
  })

  it('accepte un CTE de lecture (WITH … SELECT)', () => {
    const d = decide({
      ...base,
      query: 'WITH c AS (SELECT id FROM T) SELECT * FROM c'
    })
    expect(d.allowed).toBe(true)
  })

  /** Le cœur : tout ce qui ÉCRIT est refusé, y compris caché dans un CTE ou une sous-requête. */
  it('REFUSE toute écriture, quelle que soit sa forme', () => {
    const ecritures = [
      "UPDATE CODE_EVENEMENT_RCS SET R_CODEEVENEM_SYNONYME = 'X'",
      'DELETE FROM CODE_EVENEMENT_RCS',
      'INSERT INTO T VALUES (1)',
      'TRUNCATE TABLE T',
      'DROP TABLE T',
      'ALTER TABLE T ADD c int',
      'CREATE TABLE T (c int)',
      'MERGE T USING U ON 1=1 WHEN MATCHED THEN DELETE',
      'SELECT * INTO Copie FROM T',
      'WITH c AS (SELECT id FROM T) DELETE FROM c',
      'EXEC sp_who',
      'EXECUTE sp_who',
      "SELECT * FROM OPENROWSET('SQLNCLI','','SELECT 1')",
      'GRANT SELECT ON T TO public',
      "BACKUP DATABASE RIG_AMIENS TO DISK='x'",
      'SHUTDOWN'
    ]
    for (const query of ecritures) {
      const d = decide({ ...base, query })
      expect(d.allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE plusieurs instructions (le point-virgule est interdit)', () => {
    for (const query of ['SELECT 1; DELETE FROM T', 'SELECT 1;', 'SELECT 1 ; UPDATE T SET c=1']) {
      const d = decide({ ...base, query })
      expect(d.allowed, `accepté à tort : ${query}`).toBe(false)
      if (!d.allowed) expect(d.reason).toMatch(/instruction|point-virgule/i)
    }
  })

  it('REFUSE les commentaires — ils servent à masquer la suite', () => {
    for (const query of [
      'SELECT 1 -- puis autre chose',
      'SELECT /* ruse */ 1',
      'SELECT 1 /* DELETE FROM T */'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE ce qui ne commence pas par SELECT ou WITH', () => {
    for (const query of ['', '   ', 'sp_help T', 'USE RIG_LYON', 'SET NOCOUNT ON']) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('n’est pas dupé par la casse ni par les espaces multiples', () => {
    expect(decide({ ...base, query: '  DeLeTe   FROM T  ' }).allowed).toBe(false)
    expect(decide({ ...base, query: 'select\n\t1' }).allowed).toBe(true)
  })

  /**
   * Un mot interdit dans une CHAÎNE n'est pas une écriture : refuser « MORCA delete » comme valeur
   * cherchée rendrait l'outil inutilisable sur des données réelles.
   */
  it('un mot-clé à l’intérieur d’un littéral ne fait PAS échouer la requête', () => {
    const d = decide({
      ...base,
      query: "SELECT * FROM T WHERE libelle = 'demande de delete' OR libelle = 'drop table'"
    })
    expect(d.allowed).toBe(true)
  })

  it('mais un littéral non fermé est REFUSÉ (on ne peut plus raisonner dessus)', () => {
    expect(decide({ ...base, query: "SELECT * FROM T WHERE x = 'oups" }).allowed).toBe(false)
  })

  it('REFUSE une requête démesurée', () => {
    expect(decide({ ...base, query: 'SELECT ' + 'x,'.repeat(5000) + 'y FROM T' }).allowed).toBe(
      false
    )
  })
})

/**
 * LA CIBLE — c'est le CATALOGUE qui décide, plus un motif de nom.
 *
 * La version précédente définissait le périmètre par `^RIG_…` plus une liste de serveurs codée en
 * dur. Elle était à la fois trop large (maquettes, copies figées, bases de service) et trop étroite
 * (`RIGBD-POLYNESIE` manquait, alors qu'il héberge `RIG_PAPEETE`, greffe exploité). L'autorité est
 * `COMMUN_RIG.dbo.GREFFE` avec `GRF_IS_EXPLOIT = 1`.
 */
describe('decideSqlRead — la cible vient du catalogue, pas d’un motif de nom', () => {
  it('accepte tout couple présent au catalogue, sur les 4 serveurs', () => {
    for (const [server, database] of [
      ['SQL-PROD\\PROD', 'RIG_AMIENS'],
      ['RIGBD-ANTILLES', 'RIG_POINTE_A_PITRE'],
      ['RIGBD-POLYNESIE', 'RIG_PAPEETE'],
      ['RIGBD-REUNION', 'RIG_MAMOUDZOU']
    ]) {
      expect(
        decide({ server, database, query: 'SELECT 1 AS a' }).allowed,
        `refusé à tort : ${database}@${server}`
      ).toBe(true)
    }
  })

  it('accepte les bases de DÉVELOPPEMENT sur SQL-DEV\\DEV', () => {
    for (const database of ['RIG_DEV', 'RIG_RECETTE']) {
      expect(
        decide({ server: 'SQL-DEV\\DEV', database, query: 'SELECT 1 AS a' }).allowed,
        `refusé à tort : ${database}`
      ).toBe(true)
    }
  })

  /**
   * Ces bases existent, portent le préfixe `RIG_`, et sont `GRF_IS_EXPLOIT = 0` — vérifié dans
   * l'autorité. Aucune heuristique de nom ne pouvait les distinguer d'un greffe : c'est bien pour ça
   * que le catalogue remplace le motif.
   */
  it('REFUSE les bases RIG_ qui ne sont PAS exploitées', () => {
    for (const database of [
      'RIG_LE_PUY_MARTIN',
      'RIG_GRENOBLE_SCP',
      'RIG_AURILLAC_BECHONNET',
      'RIG_DUNKERQUE_AVANT_SELARL',
      'RIG_PUY_MAQUETTE',
      'RIG_WS_TARIF_PAP',
      'RIG_ANTIBES_FORMATION',
      'RIG_QUIMPER_RECETTE'
    ]) {
      expect(
        decide({ server: 'SQL-PROD\\PROD', database, query: 'SELECT 1 AS a' }).allowed,
        `accepté à tort : ${database}`
      ).toBe(false)
    }
  })

  /** Un greffe exploité ne l'est que sur SON serveur : le couple compte, pas la base seule. */
  it('REFUSE un greffe exploité mais sur le MAUVAIS serveur', () => {
    expect(
      decide({ server: 'SQL-PROD\\PROD', database: 'RIG_PAPEETE', query: 'SELECT 1 AS a' }).allowed
    ).toBe(false)
    expect(
      decide({ server: 'RIGBD-ANTILLES', database: 'RIG_AMIENS', query: 'SELECT 1 AS a' }).allowed
    ).toBe(false)
  })

  it('REFUSE un serveur inconnu, et liste les serveurs disponibles', () => {
    const d = decide({ server: 'SERVEUR-PIRATE', database: 'RIG_AMIENS', query: 'SELECT 1 AS a' })
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.reason).toMatch(/serveur/i)
      expect(d.reason).toContain('SQL-PROD\\PROD')
    }
  })

  it('REFUSE les bases hors RIG, dont celle qui porte les mots de passe', () => {
    for (const database of ['master', 'msdb', 'tempdb', 'AutreAppli', 'COMMUN_RIG']) {
      expect(
        decide({ server: 'SQL-PROD\\PROD', database, query: 'SELECT 1 AS a' }).allowed,
        `accepté à tort : ${database}`
      ).toBe(false)
    }
  })

  it('REFUSE un nom porteur d’injection (il part dans la ligne de commande)', () => {
    for (const database of ['RIG_A"; DROP', 'RIG_A B', 'RIG_A$(x)', 'RIG_A`x`', 'RIG_A;x']) {
      expect(
        decide({ server: 'SQL-PROD\\PROD', database, query: 'SELECT 1 AS a' }).allowed,
        `accepté à tort : ${database}`
      ).toBe(false)
    }
    for (const server of ['SQL-PROD\\PROD; DROP', 'SQL PROD', 'SQL$(x)']) {
      expect(
        decide({ server, database: 'RIG_AMIENS', query: 'SELECT 1 AS a' }).allowed,
        `accepté à tort : ${server}`
      ).toBe(false)
    }
  })

  /**
   * Autorité injoignable = défaut FERMÉ et VISIBLE. Retomber sur un motif de nom serait exactement le
   * défaut que quatre rounds d'audit ont trouvé : un périmètre qui se dégrade en silence.
   */
  it('catalogue dégradé : la production est refusée, et le message le dit', () => {
    const degrade = buildSqlTargetCatalog([{ server: 'SQL-DEV\\DEV', database: 'RIG_DEV' }], true)
    const prod = decideSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: 'SELECT 1 AS a' },
      degrade
    )
    expect(prod.allowed).toBe(false)
    if (!prod.allowed) expect(prod.reason).toMatch(/indisponible|COMMUN_RIG/i)

    const dev = decideSqlRead(
      { server: 'SQL-DEV\\DEV', database: 'RIG_DEV', query: 'SELECT 1 AS a' },
      degrade
    )
    expect(dev.allowed).toBe(true)
  })
})

/**
 * RÉGRESSION — contournement démontré par l'audit adversarial du 2026-08-07 (PR #859, note 8/100).
 *
 * La garde ne connaissait que les littéraux `'…'` et IGNORAIT les identifiants délimités `[…]` et
 * `"…"`. Une apostrophe placée dans un délimiteur d'identifiant désynchronisait le suivi des
 * littéraux de la garde du parseur réel de SQL Server : la garde voyait un littéral ouvert là où
 * SQL Server voyait un simple nom de colonne, et la suite de la requête devenait invisible.
 *
 * Ce n'était pas « un trou de plus ». Le `COMMIT TRANSACTION` injecté refermait la transaction de
 * l'enveloppe, donc le `DELETE` s'exécutait en autocommit : PERMANENT. La couche 2 (rollback
 * inconditionnel) tombait EN MÊME TEMPS que la couche 1. L'argument « garde lexicale assumée car
 * compensée par le rollback » était donc faux.
 *
 * Le principe de la correction : le contenu d'un identifiant délimité est INERTE pour SQL Server —
 * il ne peut rien exécuter. On peut donc le remplacer par un nom neutre sans rien masquer, ce qui
 * réaligne l'analyse sur ce que le serveur exécutera vraiment.
 */
describe('decideSqlRead — contournements par identifiant délimité', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE le contournement exact rapporté par l’audit', () => {
    const attaque = "SELECT 1 AS [x'a] ; COMMIT TRANSACTION ; DELETE FROM CODE_EVENEMENT_RCS ; --'"
    const d = decide({ ...base, query: attaque })
    expect(d.allowed, 'le contournement de l’audit passe encore').toBe(false)
  })

  it('REFUSE les variantes du même mécanisme', () => {
    for (const query of [
      // apostrophe cachée dans un identifiant entre guillemets doubles
      'SELECT 1 AS "x\'a" ; DELETE FROM T ; --\'',
      // apostrophe cachée dans un crochet, sans COMMIT
      "SELECT 1 AS [x'a] ; UPDATE T SET c = 1 ; --'",
      // ] échappé par ]] à l'intérieur du crochet
      "SELECT 1 AS [a]]b'] ; DELETE FROM T ; --'",
      // crochet jamais fermé : on ne sait plus lire la requête
      'SELECT 1 AS [x',
      // guillemet double jamais fermé
      'SELECT 1 AS "x'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('mais un identifiant délimité LÉGITIME passe toujours', () => {
    for (const query of [
      'SELECT [R_CODEEVENEM_VALEUR] FROM [dbo].[CODE_EVENEMENT_RCS]',
      'SELECT [a;b] FROM T', // un ; DANS un identifiant n'est pas une seconde instruction
      'SELECT [a--b] FROM T', // ni un -- un commentaire
      'SELECT [delete] FROM T', // ni un mot-clé un ordre d'écriture
      'SELECT "col espacée" FROM T',
      'SELECT [a]]b] FROM T' // identifiant contenant un ] échappé
    ]) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })
})

/**
 * RÉGRESSION — second audit adversarial (2026-08-07, note 15/100), APRÈS le premier correctif.
 *
 * Trois mécanismes distincts, tous vérifiés `allowed: true` avant correction :
 *
 * 1. `GO` sépare les lots SANS point-virgule. La garde ne connaissait que le `;` : toute la règle
 *    « une seule instruction » était contournable. `GO <n>` réexécute même le lot n fois (déni de
 *    service sur une base de production).
 * 2. Les commandes `sqlcmd` commençant par `:` sont interprétées par sqlcmd AVANT l'envoi au
 *    moteur — `:!!` lance une commande OS, `:r` exécute un script du disque. C'est plus grave qu'une
 *    écriture : on sort de SQL.
 * 3. RÉGRESSION INTRODUITE PAR LE PREMIER CORRECTIF : remplacer `[…]` par `x` collait le
 *    remplacement au jeton voisin. `delete[T]` devenait `deletex`, où `\bdelete\b` ne matche plus.
 *    Le mot-clé d'écriture était masqué par la correction elle-même. D'où un remplacement
 *    désormais ENTOURÉ D'ESPACES, qui préserve les frontières de mots.
 *
 * S'y ajoutait `commit`/`rollback` absents des mots interdits, donc l'enveloppe restait refermable.
 */
describe('decideSqlRead — contournements par le préprocesseur sqlcmd', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE GO, qui sépare les instructions sans point-virgule', () => {
    for (const query of [
      'SELECT 1\nGO\ncommit\ndelete[CODE_EVENEMENT_RCS]\nGO',
      'SELECT 1\nGO\ndelete[T]\ncommit\nGO',
      'SELECT 1\ngo\nDELETE FROM T',
      'SELECT 1\r\nGO\r\nDELETE FROM T',
      'SELECT 1\nGO 2000000000' // GO <n> : réexécution en boucle = déni de service
    ]) {
      const d = decide({ ...base, query })
      expect(d.allowed, `accepté à tort : ${JSON.stringify(query)}`).toBe(false)
    }
  })

  it('REFUSE les commandes sqlcmd (elles sortent de SQL)', () => {
    for (const query of [
      'SELECT 1\n:!! dir',
      'SELECT 1\n:r C:\\x.sql',
      'SELECT 1\n  :setvar a b'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE un mot-clé collé à un identifiant délimité (frontière de mot préservée)', () => {
    for (const query of [
      'SELECT 1\ndelete[CODE_EVENEMENT_RCS]',
      'SELECT 1\ndelete"T"',
      'SELECT * FROM T\nupdate[T]'
    ]) {
      const d = decide({ ...base, query })
      expect(d.allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE de refermer ou d’ouvrir une transaction', () => {
    for (const query of [
      'SELECT 1\ncommit',
      'SELECT 1\nCOMMIT TRANSACTION',
      'SELECT 1\nROLLBACK',
      'SELECT 1\nBEGIN TRAN'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE NEXT VALUE FOR — une séquence s’incrémente hors transaction', () => {
    expect(decide({ ...base, query: 'SELECT NEXT VALUE FOR dbo.maSeq' }).allowed).toBe(false)
  })

  it('mais une lecture multi-lignes normale passe toujours', () => {
    for (const query of [
      'SELECT R_CODEEVENEM_VALEUR\nFROM CODE_EVENEMENT_RCS\nORDER BY 1',
      'SELECT [R_CODEEVENEM_VALEUR]\nFROM [dbo].[CODE_EVENEMENT_RCS]',
      "SELECT * FROM T\nWHERE libelle = 'gomme'" // « go » dans un littéral, pas en début de ligne
    ]) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })
})

/**
 * RÉGRESSION — troisième audit adversarial (2026-08-07, notes 22 et 34/100).
 *
 * MÊME CAUSE RACINE QUE LES DEUX PREMIERS, une couche plus bas. La garde raisonne sur la structure
 * T-SQL ; `sqlcmd` découpe le texte LIGNE PAR LIGNE, totalement aveugle aux délimiteurs SQL. Comme
 * `stripDelimited` effondre une région délimitée en UN jeton, un `GO` ou une commande `:` placés sur
 * leur propre ligne À L'INTÉRIEUR d'un identifiant ou d'un littéral disparaissaient de l'analyse —
 * mais restaient bien présents, en début de ligne, dans le texte envoyé à sqlcmd.
 *
 * Vérifié : `buildReadOnlyBatch` produisait un texte contenant `GO` ET `delete` en début de ligne.
 *
 * DEUX VERROUS, parce qu'un seul se contournerait encore :
 *   - les directives sqlcmd sont cherchées sur le texte BRUT, exactement ce que sqlcmd voit ;
 *   - un retour à la ligne DANS une région délimitée est refusé — un nom de colonne ou une valeur
 *     n'en contient jamais légitimement, et c'est ce qui rend le masquage possible.
 */
describe('decideSqlRead — directive sqlcmd cachée dans une région délimitée', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE un GO dissimulé dans un identifiant ou un littéral multi-lignes', () => {
    for (const query of [
      'SELECT 1 FROM t WHERE a=1 OR [z\nGO\ndelete CODE_EVENEMENT_RCS\nGO\n]=1',
      "SELECT 'a\nGO\ndelete CODE_EVENEMENT_RCS\nGO\nb'",
      'SELECT "z\nGO\ndelete T\nGO\n" FROM t',
      'SELECT 1 FROM t WHERE a=1 OR [z\r\nGO\r\ndelete T\r\n]=1'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE une commande sqlcmd dissimulée de la même façon', () => {
    for (const query of [
      'SELECT [c\n:!! echo compromis\nx] FROM t',
      'SELECT "c\n:r C:\\evil.sql\nx" FROM t',
      "SELECT 'c\n:setvar a b\nx' FROM t"
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('mais une requête multi-lignes dont les délimiteurs tiennent sur UNE ligne passe', () => {
    for (const query of [
      'SELECT [R_CODEEVENEM_VALEUR]\nFROM [dbo].[CODE_EVENEMENT_RCS]\nWHERE 1 = 1',
      "SELECT *\nFROM CODE_EVENEMENT_RCS\nWHERE R_CODEEVENEM_VALEUR = 'MORCA'"
    ]) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })
})

/**
 * PÉRIMÈTRE, suite du troisième audit. Trois évasions distinctes, toutes constatées `allowed` :
 *  - les vues de COMPATIBILITÉ (`sysdatabases`) sont dans le schéma `sys` mais résolubles SANS
 *    qualification : chercher `sys.<vue>` ne les voyait pas. Vérifié en réel : `sysdatabases`
 *    énumérait toutes les bases du serveur depuis une base greffe ;
 *  - les FONCTIONS système (`DB_NAME`, `SERVERPROPERTY`, `SUSER_SNAME`) renseignent hors périmètre
 *    sans nommer aucune vue ;
 *  - les vues de gestion dynamique `sys.dm_exec_*` exposent jusqu'au texte des requêtes d'autres
 *    utilisateurs, donc des données d'autres bases.
 */
describe('decideSqlRead — évasions du périmètre sans nom qualifié', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE les vues de compatibilité non qualifiées', () => {
    for (const query of [
      'SELECT name FROM sysdatabases',
      'SELECT * FROM sysservers',
      'SELECT * FROM syslogins',
      'SELECT * FROM sysaltfiles',
      'SELECT * FROM sysprocesses'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE les fonctions système à portée serveur', () => {
    for (const query of [
      'SELECT DB_NAME(1) AS a',
      "SELECT DB_ID(N'master')",
      "SELECT SERVERPROPERTY('MachineName')",
      'SELECT SUSER_SNAME()',
      "SELECT * FROM fn_my_permissions(NULL,'SERVER')",
      "SELECT * FROM fn_trace_gettable('x', 1)"
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE les vues de gestion dynamique', () => {
    for (const query of [
      'SELECT * FROM sys.dm_exec_sessions',
      'SELECT * FROM sys.dm_exec_sql_text(NULL)',
      'SELECT * FROM sys.dm_os_host_info'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('mais DB_NAME() sans argument et les métadonnées locales restent lisibles', () => {
    for (const query of ['SELECT t.name FROM sys.tables t', 'SELECT c.name FROM sys.columns c']) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })
})

/**
 * 4ᵉ audit, volet PÉRIMÈTRE — les deux fuites les plus graves de toute la série, et les seules
 * constatées sur des données réelles d'AUTRES greffes.
 *
 * Cause commune : le cycle 3 a interdit les DMV (`dm_exec_*`) et les vues modernes (`sys.databases`)
 * mais PAS leurs équivalents de COMPATIBILITÉ, résolubles sans qualification. `sysdatabases` avait
 * été bouché, ses voisins non.
 *
 * Constaté en réel depuis `RIG_AMIENS` :
 *  - `syscacheobjects` → 55 948 plans d'autres bases AVEC leurs littéraux, donc du contenu
 *    applicatif d'autres greffes (`… WHERE ETP_IDDMD=355878`). C'est l'équivalent compat de
 *    `dm_exec_cached_plans` + `dm_exec_sql_text`, tous deux déjà interdits ;
 *  - `sysperfinfo` → énumère les 334 bases du serveur ;
 *  - `syslockinfo` → activité de verrouillage de 135 bases.
 */
describe('decideSqlRead — vues de compatibilité qui exposent les autres greffes', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE les vues compat équivalentes aux DMV interdites', () => {
    for (const query of [
      'SELECT TOP 2 dbid, sql FROM syscacheobjects WHERE dbid <> 1',
      "SELECT RTRIM(instance_name) AS b FROM sysperfinfo WHERE object_name LIKE '%Databases%'",
      'SELECT COUNT(DISTINCT rsc_dbid) AS n FROM syslockinfo',
      'SELECT * FROM sysoledbusers',
      'SELECT * FROM sysdevices',
      'SELECT * FROM sys.syscacheobjects'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE les fonctions et variables qui renseignent hors du greffe', () => {
    for (const query of [
      "SELECT DATABASEPROPERTYEX('master','Status') AS s",
      'SELECT @@SERVERNAME AS s',
      'SELECT @@SERVICENAME AS s',
      'SELECT @@VERSION AS v',
      'SELECT HOST_NAME() AS h',
      'SELECT APP_NAME() AS a',
      'SELECT ORIGINAL_LOGIN() AS l',
      "SELECT IS_SRVROLEMEMBER('sysadmin') AS r",
      "SELECT HAS_PERMS_BY_NAME('RIG_LYON','DATABASE','SELECT') AS p",
      "SELECT LOGINPROPERTY('x','IsLocked') AS p"
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  /**
   * Le motif énumérait les familles de DMV, donc en oubliait. Il vise maintenant la FORME `dm_<mot>_`,
   * ce qui couvre les familles présentes et futures. Le juge a vérifié 0 collision avec les vrais
   * noms de colonnes des bases RIG : la règle large ne coûte rien en usage réel.
   */
  it('REFUSE toute vue de gestion dynamique, famille connue ou non', () => {
    for (const query of [
      'SELECT * FROM sys.dm_database_encryption_keys',
      'SELECT * FROM sys.dm_hadr_cluster',
      'SELECT * FROM sys.dm_broker_connections',
      'SELECT * FROM sys.dm_fts_index_population',
      'SELECT * FROM sys.dm_repl_articles'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE les vues de configuration serveur', () => {
    for (const query of [
      'SELECT name FROM sys.configurations',
      'SELECT * FROM sys.server_role_members',
      'SELECT * FROM sys.tcp_endpoints'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('mais les métadonnées de portée BASE restent lisibles', () => {
    for (const query of [
      'SELECT name FROM sys.objects',
      'SELECT name FROM sys.database_principals',
      'SELECT name FROM sysobjects',
      'SELECT TABLE_NAME AS t FROM INFORMATION_SCHEMA.TABLES',
      'SELECT COLUMN_NAME AS c FROM INFORMATION_SCHEMA.COLUMNS',
      'SELECT USER_NAME() AS u',
      'SELECT SCHEMA_NAME() AS s'
    ]) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })
})

/**
 * 4ᵉ audit, FAUX REFUS le seul bloquant : la règle « 3 parties » comptait les segments sans regarder
 * ce qu'ils NOMMENT. `dbo.INS_INFOGREFFE.[date insc]` est du T-SQL valide et strictement local —
 * vérifié, il retourne des lignes sur `RIG_AMIENS`. C'est la forme que produisent les générateurs SQL
 * et les LLM. Le danger vient de la PREMIÈRE partie quand elle nomme une base ou un serveur, pas du
 * nombre de segments.
 */
describe('decideSqlRead — nom qualifié par le SCHÉMA, pas par la base', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('accepte schéma.table.colonne, qui est local', () => {
    for (const query of [
      'SELECT dbo.INS_INFOGREFFE.[date insc] FROM dbo.INS_INFOGREFFE',
      'SELECT dbo.T.A, dbo.T.B FROM dbo.T',
      'SELECT [dbo].[T].[col] FROM [dbo].[T]',
      'SELECT sys.tables.name FROM sys.tables'
    ]) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })

  it('REFUSE toujours ce qui nomme une autre base ou un serveur', () => {
    for (const query of [
      'SELECT name FROM master.sys.databases',
      'SELECT * FROM RIG_PARIS.dbo.CODE_EVENEMENT_RCS',
      'SELECT * FROM RIG_PARIS..CODE_EVENEMENT_RCS',
      'SELECT * FROM [SOMELINK].master.sys.databases',
      'SELECT * FROM [SOMELINK].[master].[sys].[databases]',
      'SELECT RIGBD5.RIG_X.dbo.T.col FROM RIGBD5.RIG_X.dbo.T'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })
})

/**
 * (Le bloc « bases hors périmètre malgré le préfixe RIG_ » a été retiré : le catalogue a remplacé
 * l'heuristique de nom, et ces cas sont désormais couverts par « la cible vient du catalogue » —
 * y compris `RIG_PUY_MAQUETTE` et les bases de service, refusées parce qu'elles ne sont pas
 * `GRF_IS_EXPLOIT = 1`, et non parce que leur nom y ressemble.)
 */

/**
 * EFFET SUR LA PRODUCTION SANS ÉCRITURE. Un indice de table est PRIORITAIRE sur le niveau
 * d'isolation posé par l'enveloppe : `WITH (TABLOCKX, HOLDLOCK)` prend un verrou exclusif de table
 * tenu jusqu'au `ROLLBACK`. `SET LOCK_TIMEOUT` protège NOTRE session, pas les greffiers qui
 * écrivent en face — ils seraient bloqués. C'est exactement ce que l'en-tête du module dit vouloir
 * éviter : « une écriture annulée a quand même pris des verrous ».
 */
describe('decideSqlRead — pas de verrou imposé à une base de production', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE les indices de verrouillage', () => {
    for (const query of [
      'SELECT TOP 1 * FROM DEMANDE WITH (TABLOCKX, HOLDLOCK)',
      'SELECT * FROM T WITH (UPDLOCK, HOLDLOCK, ROWLOCK)',
      'SELECT * FROM T WITH (XLOCK, TABLOCK) WHERE 1=0',
      'SELECT * FROM T WITH (SERIALIZABLE)',
      'SELECT * FROM T WITH (REPEATABLEREAD)'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('mais les indices de lecture inoffensifs passent', () => {
    for (const query of ['SELECT * FROM T WITH (NOLOCK)', 'SELECT * FROM T WITH (INDEX(1))']) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })
})

/**
 * fix-ok: nouveaux tests de couverture (pas un correctif à l'aveugle) — le constat est reproduit en
 * réel par le 4ᵉ audit : `SELECT 1 AS a SELECT 2 AS b` exécute DEUX instructions sur SQL Server.
 *
 * 4ᵉ audit — constat structurel : **T-SQL juxtapose les instructions SANS séparateur.**
 * La garantie « une seule instruction » ne repose donc PAS sur l'interdiction du `;` ni du `GO`,
 * contrairement à ce que les deux premiers cycles laissaient croire : elle repose ENTIÈREMENT sur la
 * liste de mots-clés.
 *
 * Ces formes-ci seraient de toute façon annulées par l'enveloppe transactionnelle (l'attaquant ne
 * peut plus la refermer, `commit`/`rollback`/`begin` étant interdits). On les bloque quand même :
 * une garantie affichée aussi fort ne doit pas dépendre d'un seul filet.
 */
describe('decideSqlRead — juxtaposition d’instructions sans séparateur', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE une seconde instruction à effet, même sans point-virgule ni GO', () => {
    for (const query of [
      'SELECT 1 AS a RECEIVE * FROM maFile',
      'SELECT 1 AS a SEND ON CONVERSATION x',
      'SELECT 1 AS a CHECKPOINT',
      'SELECT 1 AS a DISABLE TRIGGER ALL ON T',
      'SELECT 1 AS a ENABLE TRIGGER ALL ON T',
      'SELECT 1 AS a WHILE (1=1) SELECT 1'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })
})

/**
 * PÉRIMÈTRE — second défaut de l'audit. Seul le nom passé à `-d` était validé, alors qu'un nom
 * d'objet qualifié traverse les bases : la garde promettait « une seule base greffe, jamais master »
 * et ne la tenait pas.
 */
describe('decideSqlRead — le périmètre annoncé est réellement tenu', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('REFUSE de sortir de la base ciblée par un nom qualifié', () => {
    for (const query of [
      'SELECT name FROM master.sys.databases',
      'SELECT * FROM RIG_PARIS.dbo.CODE_EVENEMENT_RCS',
      'SELECT * FROM RIG_PARIS..CODE_EVENEMENT_RCS',
      'SELECT * FROM [SOMELINK].master.sys.databases',
      'SELECT * FROM [SOMELINK].[master].[sys].[databases]'
    ]) {
      const d = decide({ ...base, query })
      expect(d.allowed, `accepté à tort : ${query}`).toBe(false)
      if (!d.allowed) expect(d.reason).toMatch(/base|périmètre|qualifi/i)
    }
  })

  it('REFUSE les vues système à portée SERVEUR, même en deux parties', () => {
    for (const query of [
      'SELECT name FROM sys.databases',
      'SELECT * FROM sys.servers',
      'SELECT name FROM sys.sql_logins',
      'SELECT * FROM sys.server_principals',
      // Second audit : délimiter la 2ᵉ partie masquait le nom au motif de recherche.
      'SELECT name FROM sys.[databases]',
      'SELECT name FROM [sys].[databases]',
      'SELECT * FROM sys.[sql_logins]',
      'SELECT * FROM [sys].servers'
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('mais un nom en deux parties dans la base courante reste autorisé', () => {
    for (const query of [
      'SELECT * FROM dbo.CODE_EVENEMENT_RCS',
      'SELECT c.name FROM sys.columns c', // métadonnées de la base courante : utile et sans risque
      'SELECT t.name FROM sys.tables t'
    ]) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })
})

/**
 * FAUX REFUS — troisième défaut de l'audit. `sp_`/`xp_` étaient cherchés en SOUS-CHAÎNE, ce qui
 * rejetait des colonnes de production réelles. Les noms ci-dessous ont été vérifiés existants dans
 * RIG_AMIENS. `EXEC`/`EXECUTE` interdisent déjà l'appel de procédure : chercher le préfixe ailleurs
 * qu'en début de jeton n'apportait aucune sécurité et coûtait des familles entières de colonnes.
 */
describe('decideSqlRead — pas de faux refus sur des colonnes réelles', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('accepte les colonnes de production contenant sp/xp au milieu d’un nom', () => {
    for (const query of [
      'SELECT R_ACTIVITESP_VALEUR FROM ACTIVITE_SP',
      'SELECT BDCRCX_BOITE_POSTALE_SP_X FROM BORDEREAU_CRCX',
      'SELECT MNTSP_ID_MNTSP FROM MENTION_SP',
      'SELECT EXPEDITION_ID FROM EXPEDITION' // « exp » contient xp
    ]) {
      expect(decide({ ...base, query }).allowed, `refusé à tort : ${query}`).toBe(true)
    }
  })

  it('tout en REFUSANT un vrai appel de procédure système', () => {
    for (const query of [
      'EXEC sp_who',
      'SELECT * FROM sp_helptext',
      "SELECT * FROM OPENROWSET('x','y','exec xp_cmdshell ''dir''')"
    ]) {
      expect(decide({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })
})
