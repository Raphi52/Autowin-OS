/**
 * La découverte confrontée à une VRAIE base de greffe, et non à un exemple inventé.
 *
 * Le contrôle précédent avait raison sur un point : rien ne prouvait que la table des actions
 * existe réellement, ni que l'heuristique tombe dessus. Mesuré le 2026-09-17 sur `SQL-DEV\DEV` /
 * `RIG_DEV` (sqlcmd, code de sortie 0) : la base contient bien `dbo.AUDIT` (496 904 lignes), avec
 * `AUDIT_LOGIN` (qui), `AUDIT_DATE` (quand) et `AUDIT_TABLE` (sur quoi). La réponse brute de
 * `REQUETE_TABLES_AUDIT` — 388 lignes, 32 tables candidates — est figée dans
 * `__fixtures__/rig-dev-tables-audit.json` : ce test rejoue la découverte sur la matière réelle,
 * sans dépendre du réseau.
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { choisirTableAudit, construireRequeteActions, type LigneColonne } from './greffe-actions'

const lignes = JSON.parse(
  readFileSync(join(__dirname, '__fixtures__', 'rig-dev-tables-audit.json'), 'utf8')
) as LigneColonne[]

describe('découverte sur la base réelle RIG_DEV', () => {
  it('la capture est bien celle de la base, pas un exemple réduit', () => {
    expect(lignes.length).toBe(388)
    expect(lignes.some((l) => l.t === 'AUDIT' && l.c === 'AUDIT_LOGIN')).toBe(true)
  })

  it('choisit dbo.AUDIT, la table qui trace qui a fait quoi', () => {
    const source = choisirTableAudit(lignes)
    expect(source).toEqual({
      schema: 'dbo',
      table: 'AUDIT',
      colonneUtilisateur: 'AUDIT_LOGIN',
      colonneDate: 'AUDIT_DATE',
      colonneAction: 'AUDIT_TABLE'
    })
  })

  it("construit une lecture qui nomme l'objet de l'action, pas une colonne vide", () => {
    const requete = construireRequeteActions(choisirTableAudit(lignes)!, 5)
    expect(requete).toBe(
      'SELECT TOP 5 [AUDIT_LOGIN] AS utilisateur, [AUDIT_DATE] AS quand, [AUDIT_TABLE] AS action ' +
        'FROM [dbo].[AUDIT] ORDER BY [AUDIT_DATE] DESC FOR JSON PATH'
    )
  })
})
