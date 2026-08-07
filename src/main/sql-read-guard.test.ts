import { describe, expect, it } from 'vitest'
import { RIG_SQL_SERVERS, decideSqlRead } from './sql-read-guard'

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
describe('decideSqlRead — seule une lecture unique passe', () => {
  const base = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }

  it('accepte un SELECT simple', () => {
    const d = decideSqlRead({ ...base, query: 'SELECT R_CODEEVENEM_VALEUR FROM CODE_EVENEMENT_RCS' })
    expect(d.allowed).toBe(true)
  })

  it('accepte un SELECT avec jointure, WHERE, ORDER BY et fonctions', () => {
    const d = decideSqlRead({
      ...base,
      query:
        "SELECT TOP 10 a.x, COUNT(*) AS n FROM T a JOIN U b ON b.id = a.id WHERE a.v = 'MORCA' GROUP BY a.x HAVING COUNT(*) > 1 ORDER BY n DESC"
    })
    expect(d.allowed).toBe(true)
  })

  it('accepte un CTE de lecture (WITH … SELECT)', () => {
    const d = decideSqlRead({
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
      "INSERT INTO T VALUES (1)",
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
      const d = decideSqlRead({ ...base, query })
      expect(d.allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE plusieurs instructions (le point-virgule est interdit)', () => {
    for (const query of [
      'SELECT 1; DELETE FROM T',
      'SELECT 1;',
      "SELECT 1 ; UPDATE T SET c=1"
    ]) {
      const d = decideSqlRead({ ...base, query })
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
      expect(decideSqlRead({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('REFUSE ce qui ne commence pas par SELECT ou WITH', () => {
    for (const query of ['', '   ', 'sp_help T', 'USE RIG_LYON', 'SET NOCOUNT ON']) {
      expect(decideSqlRead({ ...base, query }).allowed, `accepté à tort : ${query}`).toBe(false)
    }
  })

  it('n’est pas dupé par la casse ni par les espaces multiples', () => {
    expect(decideSqlRead({ ...base, query: '  DeLeTe   FROM T  ' }).allowed).toBe(false)
    expect(decideSqlRead({ ...base, query: 'select\n\t1' }).allowed).toBe(true)
  })

  /**
   * Un mot interdit dans une CHAÎNE n'est pas une écriture : refuser « MORCA delete » comme valeur
   * cherchée rendrait l'outil inutilisable sur des données réelles.
   */
  it('un mot-clé à l’intérieur d’un littéral ne fait PAS échouer la requête', () => {
    const d = decideSqlRead({
      ...base,
      query: "SELECT * FROM T WHERE libelle = 'demande de delete' OR libelle = 'drop table'"
    })
    expect(d.allowed).toBe(true)
  })

  it('mais un littéral non fermé est REFUSÉ (on ne peut plus raisonner dessus)', () => {
    expect(decideSqlRead({ ...base, query: "SELECT * FROM T WHERE x = 'oups" }).allowed).toBe(false)
  })

  it('REFUSE une requête démesurée', () => {
    expect(decideSqlRead({ ...base, query: 'SELECT ' + 'x,'.repeat(5000) + 'y FROM T' }).allowed).toBe(
      false
    )
  })
})

describe('decideSqlRead — cible autorisée', () => {
  it('n’accepte que les serveurs RIG connus', () => {
    for (const server of RIG_SQL_SERVERS) {
      expect(decideSqlRead({ server, database: 'RIG_AMIENS', query: 'SELECT 1' }).allowed).toBe(true)
    }
  })

  it('REFUSE un serveur inconnu, et liste les serveurs valides', () => {
    const d = decideSqlRead({
      server: 'SERVEUR-PIRATE',
      database: 'RIG_AMIENS',
      query: 'SELECT 1'
    })
    expect(d.allowed).toBe(false)
    if (!d.allowed) {
      expect(d.reason).toMatch(/serveur/i)
      expect(d.reason).toContain('SQL-PROD\\PROD')
    }
  })

  it('REFUSE une base hors périmètre RIG (master, msdb, autre applicatif)', () => {
    for (const database of ['master', 'msdb', 'tempdb', 'AutreAppli', 'RIGSOMETHING']) {
      const d = decideSqlRead({ server: 'SQL-PROD\\PROD', database, query: 'SELECT 1' })
      expect(d.allowed, `accepté à tort : ${database}`).toBe(false)
    }
  })

  it('accepte les bases RIG_ y compris les variantes de greffe', () => {
    for (const database of ['RIG_AMIENS', 'RIG_LE_PUY_MARTIN', 'RIG_GRENOBLE_SCP']) {
      expect(decideSqlRead({ server: 'SQL-PROD\\PROD', database, query: 'SELECT 1' }).allowed).toBe(
        true
      )
    }
  })

  it('REFUSE un nom de base porteur d’injection (il part dans la ligne de commande)', () => {
    for (const database of ['RIG_A"; DROP', 'RIG_A B', 'RIG_A$(x)', 'RIG_A`x`', 'RIG_A;x']) {
      expect(decideSqlRead({ server: 'SQL-PROD\\PROD', database, query: 'SELECT 1' }).allowed).toBe(
        false
      )
    }
  })
})
