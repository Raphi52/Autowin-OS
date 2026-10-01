import { describe, expect, it } from 'vitest'
import { construireAutoriteProd } from './prod-guard'
import { CoffreAutorisationProd, definirPhrase } from './prod-passphrase'
import { PorteProd } from './prod-gate'
import { buildSqlTargetCatalog } from './sql-read-catalog'

/**
 * conv-554 : une lecture sql-read sur RIG_DEV (SQL-DEV\DEV) ouvrait une demande d'autorisation, car
 * la liste de déclaration sur disque ne la couvrait pas. Toute base de SQL-DEV\DEV est lisible sans
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
  it('RIG_DEV et une base quelconque de SQL-DEV\\DEV passent sans confirmation', () => {
    for (const nom of ['RIG_DEV', 'RIG_AUTRE_DEV']) {
      expect(
        porte().verifier({ nature: 'base', nom, serveur: 'sql-dev\\dev', operation: 'sql-read' }).autorise
      ).toBe(true)
    }
  })

  it('une base non déclarée sur un autre serveur reste bloquée', () => {
    expect(
      porte().verifier({ nature: 'base', nom: 'RIG_DEV', serveur: 'SQL-PROD\\PROD', operation: 'sql-read' })
        .autorise
    ).toBe(false)
  })

  it('un autre geste que sql-read sur SQL-DEV\\DEV garde sa confirmation', () => {
    expect(
      porte().verifier({ nature: 'base', nom: 'RIG_DEV', serveur: 'SQL-DEV\\DEV', operation: 'run-sqlcmd' })
        .autorise
    ).toBe(false)
  })

  it('le catalogue accepte toute base de SQL-DEV\\DEV, pas des autres serveurs', () => {
    const cat = buildSqlTargetCatalog([])
    expect(cat.has('SQL-DEV\\DEV', 'RIG_QUELCONQUE')).toBe(true)
    expect(cat.has('SQL-PROD\\PROD', 'RIG_QUELCONQUE')).toBe(false)
  })
})
