import { describe, expect, it } from 'vitest'
import { decideSqlRead } from './sql-read-guard'
import { buildSqlTargetCatalog } from './sql-read-catalog'

/**
 * BASE OMISE : le refus doit dire QUOI corriger, pas « nom invalide : «  » ».
 *
 * Mesure conv-599, tour `fa92ae4e-2126-40bf-9a21-e7133ebdd962` : l'appel modele d'iteration 0
 * (75 s, 0,51 USD) emet `sql_query` SANS `database`. Le refus rendu ne nomme pas l'argument
 * manquant et ne liste rien ; l'iteration 1 rejoue la MEME requete en ajoutant la cible a
 * l'aveugle. Un aller-retour entier paye pour une information que le garde connait deja.
 */
const CATALOGUE = buildSqlTargetCatalog([
  { server: 'SQL-PROD\PROD', database: 'RIG_AMIENS' },
  { server: 'SQL-DEV\DEV', database: 'RIG_DEV' }
])

describe('garde SQL — argument de cible absent', () => {
  it('nomme la base manquante et liste les bases du serveur', () => {
    const refus = decideSqlRead(
      { server: 'SQL-DEV\DEV', query: 'SELECT 1 AS n' },
      CATALOGUE
    )
    expect(refus.allowed).toBe(false)
    const reason = refus.allowed ? '' : refus.reason
    expect(reason).toContain('database')
    expect(reason).toContain('RIG_DEV')
  })

  it('nomme le serveur manquant et liste les serveurs connus', () => {
    const refus = decideSqlRead({ database: 'RIG_DEV', query: 'SELECT 1 AS n' }, CATALOGUE)
    expect(refus.allowed).toBe(false)
    const reason = refus.allowed ? '' : refus.reason
    expect(reason).toContain('server')
    expect(reason).toContain('SQL-DEV\DEV')
  })
})
