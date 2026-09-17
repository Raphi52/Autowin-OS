import { describe, expect, it } from 'vitest'
import {
  REQUETE_TABLES_AUDIT,
  choisirTableAudit,
  construireRequeteActions,
  lireActionsGreffe,
  type LigneColonne
} from './greffe-actions'
import { decideSqlRead } from './sql-read-guard'
import { buildSqlTargetCatalog } from './sql-read-catalog'

const catalogue = buildSqlTargetCatalog([{ server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }])

const colonnes = (table: string, noms: string[]): LigneColonne[] =>
  noms.map((c) => ({ s: 'dbo', t: table, c }))

describe('découverte de la table qui trace les actions', () => {
  it('la requête de découverte passe la garde de lecture seule', () => {
    const decision = decideSqlRead(
      { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS', query: REQUETE_TABLES_AUDIT },
      catalogue
    )
    expect(decision).toMatchObject({ allowed: true })
  })

  it('retient une table qui a un utilisateur ET une date', () => {
    const source = choisirTableAudit([
      ...colonnes('PARAMETRAGE', ['PAR_CODE', 'PAR_VALEUR']),
      ...colonnes('AUDIT_ACTION', ['AUD_ID', 'AUD_UTILISATEUR', 'AUD_DATE', 'AUD_LIBELLE'])
    ])
    expect(source).toEqual({
      schema: 'dbo',
      table: 'AUDIT_ACTION',
      colonneUtilisateur: 'AUD_UTILISATEUR',
      colonneDate: 'AUD_DATE',
      colonneAction: 'AUD_LIBELLE'
    })
  })

  it('ignore une table de journal sans colonne utilisateur', () => {
    expect(choisirTableAudit(colonnes('LOG_TECHNIQUE', ['LOG_DATE', 'LOG_MESSAGE']))).toBeNull()
  })

  it('préfère AUDIT à LOG quand les deux conviennent', () => {
    const source = choisirTableAudit([
      ...colonnes('LOG_ACTION', ['LOG_USER', 'LOG_DATE', 'LOG_ACTION']),
      ...colonnes('AUDIT_TRACE', ['AUD_USER', 'AUD_DATE', 'AUD_ACTION'])
    ])
    expect(source?.table).toBe('AUDIT_TRACE')
  })
})

describe('requête des actions', () => {
  const source = {
    schema: 'dbo',
    table: 'AUDIT_ACTION',
    colonneUtilisateur: 'AUD_UTILISATEUR',
    colonneDate: 'AUD_DATE',
    colonneAction: 'AUD_LIBELLE'
  }

  it('passe la garde de lecture seule', () => {
    const decision = decideSqlRead(
      {
        server: 'SQL-PROD\\PROD',
        database: 'RIG_AMIENS',
        query: construireRequeteActions(source, 50)
      },
      catalogue
    )
    expect(decision).toMatchObject({ allowed: true })
  })

  it('trie du plus récent au plus ancien et borne le nombre de lignes', () => {
    const requete = construireRequeteActions(source, 50)
    expect(requete).toContain('TOP 50')
    expect(requete).toContain('ORDER BY [AUD_DATE] DESC')
  })

  it('refuse un nom de table qui n’est pas un identifiant simple', () => {
    expect(() =>
      construireRequeteActions({ ...source, table: 'A]; DROP TABLE B --' }, 10)
    ).toThrow()
  })
})

describe('lecture bout en bout', () => {
  const cible = { server: 'SQL-PROD\\PROD', database: 'RIG_AMIENS' }
  const decouverte = [
    { s: 'dbo', t: 'AUDIT_ACTION', c: 'AUD_UTILISATEUR' },
    { s: 'dbo', t: 'AUDIT_ACTION', c: 'AUD_DATE' },
    { s: 'dbo', t: 'AUDIT_ACTION', c: 'AUD_LIBELLE' }
  ]

  it('découvre la table puis rend les actions', async () => {
    const vues: string[] = []
    const resultat = await lireActionsGreffe(cible, 20, {
      runSqlRead: async (args) => {
        vues.push(args.query)
        if (args.query === REQUETE_TABLES_AUDIT) {
          return { ok: true, rows: decouverte, rowCount: 3, truncated: false, summary: '' }
        }
        return {
          ok: true,
          rows: [{ utilisateur: 'MDUPONT', quand: '2026-09-17T09:00:00', action: 'Dépôt acte' }],
          rowCount: 1,
          truncated: false,
          summary: ''
        }
      }
    })
    expect(resultat).toMatchObject({
      ok: true,
      greffe: 'RIG_AMIENS',
      actions: [{ utilisateur: 'MDUPONT', action: 'Dépôt acte' }]
    })
    expect(vues).toHaveLength(2)
  })

  it('dit pourquoi quand aucune table ne trace d’utilisateur, au lieu d’un écran vide', async () => {
    const resultat = await lireActionsGreffe(cible, 20, {
      runSqlRead: async () => ({ ok: true, rows: [], rowCount: 0, truncated: false, summary: '' })
    })
    expect(resultat.ok).toBe(false)
    expect(resultat.ok === false && resultat.raison).toMatch(/aucune table/i)
  })

  it('remonte le refus de la garde sans le masquer', async () => {
    const resultat = await lireActionsGreffe(cible, 20, {
      runSqlRead: async () => ({ ok: false, reason: 'Base hors catalogue' })
    })
    expect(resultat).toEqual({ ok: false, raison: 'Base hors catalogue' })
  })
})
