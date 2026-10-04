import { describe, expect, it } from 'vitest'
import { configureSqlCatalog as configurerCatalogueTest } from './sql-read-catalog'
import { TEST_SQL_CATALOG } from './sql-catalog.test-fixture'

configurerCatalogueTest(TEST_SQL_CATALOG)
import { construireAutoriteProd } from './prod-guard'
import { CoffreAutorisationProd, definirPhrase } from './prod-passphrase'
import { PorteProd } from './prod-gate'
import { buildSqlTargetCatalog } from './sql-read-catalog'

/**
 * conv-554 : une lecture sql-read sur APP_DEV (SRV-DEV\DEV) ouvrait une demande d'autorisation, car
 * la liste de déclaration sur disque ne la couvrait pas. Toute base de SRV-DEV\DEV est lisible sans
 * confirmation ; le reste garde sa protection.
 */
function porte() {
  return new PorteProd({
    autorite: () => construireAutoriteProd([]),
    coffre: () => new CoffreAutorisationProd(definirPhrase('x-phrase-test', 1_000)),
    phraseDefinie: () => true,
    niveau: () => 'confirmation'
  })
}

describe('lectures sur le serveur de développement', () => {
  it('APP_DEV et une base quelconque de SRV-DEV\\DEV passent sans confirmation', () => {
    for (const nom of ['APP_DEV', 'APP_AUTRE_DEV']) {
      expect(
        porte().verifier({ nature: 'base', nom, serveur: 'srv-dev\\dev', operation: 'sql-read' }).autorise
      ).toBe(true)
    }
  })

  it('une base non déclarée sur un autre serveur reste bloquée', () => {
    expect(
      porte().verifier({ nature: 'base', nom: 'APP_DEV', serveur: 'SRV-PROD\\PROD', operation: 'sql-read' })
        .autorise
    ).toBe(false)
  })

  it('un autre geste que sql-read sur SRV-DEV\\DEV garde sa confirmation', () => {
    expect(
      porte().verifier({ nature: 'base', nom: 'APP_DEV', serveur: 'SRV-DEV\\DEV', operation: 'run-sqlcmd' })
        .autorise
    ).toBe(false)
  })

  it('le catalogue accepte toute base de SRV-DEV\\DEV, pas des autres serveurs', () => {
    const cat = buildSqlTargetCatalog([])
    expect(cat.has('SRV-DEV\\DEV', 'APP_QUELCONQUE')).toBe(true)
    expect(cat.has('SRV-PROD\\PROD', 'APP_QUELCONQUE')).toBe(false)
  })
})
