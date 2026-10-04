import { describe, expect, it, vi } from 'vitest'
import { configureSqlCatalog as configurerCatalogueTest } from './sql-read-catalog'
import { TEST_SQL_CATALOG } from './sql-catalog.test-fixture'

configurerCatalogueTest(TEST_SQL_CATALOG)
import { buildSqlTargetCatalog } from './sql-read-catalog'
import { runSqlRead } from './sql-read-command'
import { PorteProd } from './prod-gate'
import { construireAutoriteProd, type EntreeAutorite } from './prod-guard'
import { CoffreAutorisationProd, definirPhrase } from './prod-passphrase'

/**
 * UN SERVEUR DÉCLARÉ NON-PROD COUVRE SES BASES, DANS `sql_query` AUSSI.
 *
 * conv-106, tour 41d5a982-93d1-4933-be80-e8ea1fbc7bbf (saisie ts 1790604144331) : l'utilisateur veut
 * des SELECT sur APP_DEV, hébergée sur SRV-DEV\DEV. Le contrôle du terminal a été corrigé (commit
 * dece44cf), mais `runSqlRead` ne passait à la porte que `nature: 'base'` : une déclaration
 * `nature: 'serveur'` n'y comptait pas. Barre oblique construite par fromCharCode(92) : un littéral
 * à une seule barre deviendrait `SRV-DEVDEV` et le test ne prouverait rien.
 */
const BARRE = String.fromCharCode(92)
const SQL_DEV = `SRV-DEV${BARRE}DEV`
const SQL_PROD = `SRV-PROD${BARRE}PROD`

const CATALOGUE = buildSqlTargetCatalog([
  { server: SQL_DEV, database: 'APP_DEV' },
  { server: SQL_DEV, database: 'APP_DEV_PROD_DECLAREE' },
  { server: SQL_PROD, database: 'APP_DEV' }
])

function montage(declarations: EntreeAutorite[]) {
  const autorite = construireAutoriteProd(declarations)
  const coffre = new CoffreAutorisationProd(definirPhrase('phrase-de-reference', 1_000))
  const porteProd = new PorteProd({
    autorite: () => autorite,
    coffre: () => coffre,
    phraseDefinie: () => true,
    niveau: () => 'confirmation'
  })
  /** Témoin : s'il est appelé, la porte a laissé passer et une connexion a été tentée. */
  const lancer = vi.fn(() => {
    throw new Error('connexion tentée')
  })
  return { porteProd, lancer }
}

async function lire(server: string, database: string, declarations: EntreeAutorite[]) {
  const { porteProd, lancer } = montage(declarations)
  const resultat = await runSqlRead(
    { server, database, query: 'SELECT 1 AS n' },
    { catalog: CATALOGUE, porteProd, spawnFn: lancer as never, sqlcmdPath: 'sqlcmd' }
  )
  return { resultat, lancer }
}

describe('sql_query : serveur déclaré non-prod', () => {
  it('laisse passer APP_DEV quand SRV-DEV\\DEV est déclaré serveur non-prod', async () => {
    const { resultat, lancer } = await lire(SQL_DEV, 'APP_DEV', [
      { nature: 'serveur', nom: SQL_DEV, classe: 'non-prod' }
    ])
    expect(lancer).toHaveBeenCalled()
    expect(resultat.ok).toBe(false) // le témoin jette : preuve que la porte a laissé passer
  })

  // conv-554 (2026-09-29) : l'utilisateur veut des SELECT sur TOUTES les bases de SRV-DEV\DEV sans
  // autorisation, même quand la liste sur disque ne les déclare pas.
  it('laisse passer APP_DEV sur SRV-DEV\\DEV sans aucune déclaration', async () => {
    const { lancer } = await lire(SQL_DEV, 'APP_DEV', [])
    expect(lancer).toHaveBeenCalled()
  })

  it('refuse sans déclaration un serveur qui ne s’appelle pas exactement SRV-DEV\\DEV', async () => {
    const { lancer } = await lire('SRV-DEVDEV', 'APP_DEV', [])
    expect(lancer).not.toHaveBeenCalled()
  })

  it('refuse la même base sur SRV-PROD\\PROD', async () => {
    const { lancer } = await lire(SQL_PROD, 'APP_DEV', [
      { nature: 'serveur', nom: SQL_DEV, classe: 'non-prod' }
    ])
    expect(lancer).not.toHaveBeenCalled()
  })

  it('une base déclarée prod reste bloquée même sur un serveur non-prod', async () => {
    const { lancer } = await lire(SQL_DEV, 'APP_DEV_PROD_DECLAREE', [
      { nature: 'serveur', nom: SQL_DEV, classe: 'non-prod' },
      { nature: 'base', nom: 'APP_DEV_PROD_DECLAREE', classe: 'prod' }
    ])
    expect(lancer).not.toHaveBeenCalled()
  })
})
