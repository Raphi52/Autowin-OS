// fix-ok: valeurs propres à entreprise (serveur, base, table, colonnes du catalogue) écrites en dur — mesuré par grep; remplacées par la config sql-catalog.json, fermée par défaut (tests sql-read-catalog/guard rouge si on rouvre)
import type { SqlCatalogConfig } from './sql-read-catalog'

/**
 * Configuration de catalogue SQL FICTIVE, partagée par les tests. Aucun nom d'entreprise :
 * le code ne connaît plus que ce que `sql-catalog.json` lui donne.
 */
export const TEST_SQL_CATALOG: SqlCatalogConfig = {
  server: 'SRV-PROD\\PROD',
  database: 'CATALOGUE',
  table: 'dbo.BASES',
  databaseColumn: 'COL_NOMBASE_BD',
  serverColumn: 'COL_SERVEUR_BD',
  exploitColumn: 'COL_IS_EXPLOIT',
  devTargets: [
    { server: 'SRV-DEV\\DEV', database: 'APP_DEV' },
    { server: 'SRV-DEV\\DEV', database: 'APP_RECETTE' }
  ],
  devServers: ['SRV-DEV\\DEV']
}
