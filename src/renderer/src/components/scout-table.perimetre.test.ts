import { describe, expect, it } from 'vitest'
import { parseScoutTable } from './scout-table'

/**
 * LE PANNEAU À CASES DISPARAISSAIT EN SILENCE SUR UN VRAI SCOUT.
 *
 * Mesuré en pilotant l'app le 2026-08-19 : un scout a rendu un tableau avec les colonnes
 * « Score | Type | Quoi | Ancrage fichier:ligne | Preuve que l'appelant manque ». L'utilisateur a
 * immédiatement vu ce qui manquait : « c'est pas celui que j'aime avec les cases à cocher et le
 * bouton ».
 *
 * Cause : `isScoutHeader` exigeait une colonne « Why » (`why|pourquoi|valeur`) OU « How »
 * (`how|1er pas|premier|first`). « Ancrage » et « Preuve » ne matchent ni l'une ni l'autre, donc le
 * tableau était refusé et retombait en Markdown MORT — sans aucun signal expliquant pourquoi. La
 * fonctionnalité existait, était testée, était branchée, et devenait inatteignable dès que le modèle
 * nommait ses colonnes autrement. Or l'ancrage et la preuve jouent exactement le rôle du « où
 * commencer » : ce sont des colonnes de scout, pas autre chose.
 */
describe('parseScoutTable — le panneau de sélection accepte les colonnes de PREUVE', () => {
  const tableau = (entete: string): string =>
    [
      entete,
      '| ---: | --- | --- | --- | --- |',
      '| 92 | fix | Outils Claude neutralisés | src/main/providers/claude.ts:494 | aucun appelant |',
      '| 84 | new | Roadmap non branchée | skills/_engine/ENGINE.md:106 | NOT wired |'
    ].join('\n')

  it('accepte l’en-tête EXACT rendu par l’app', () => {
    const rows = parseScoutTable(
      tableau("| Score | Type | Quoi | Ancrage fichier:ligne | Preuve que l'appelant manque |")
    )
    expect(rows).not.toBeNull()
    expect(rows).toHaveLength(2)
    expect(rows?.[0]).toMatchObject({ score: 92, type: 'fix' })
    expect(rows?.[0].what).toContain('Outils Claude')
  })

  it('accepte les variantes anglaises de la même colonne', () => {
    for (const entete of [
      '| Score | Type | What | Anchor | Evidence |',
      '| Score | Type | Quoi | Où vérifier | Preuve |',
      '| Score | Type | Candidat | fichier:ligne | preuve du manque |'
    ]) {
      expect(parseScoutTable(tableau(entete))).not.toBeNull()
    }
  })

  it('CONTRE-EXEMPLE — les en-têtes historiques continuent de marcher', () => {
    expect(parseScoutTable(tableau('| Score | Type | What | Why | How |'))).not.toBeNull()
    expect(
      parseScoutTable(tableau('| # | Impact | Effort | Manquement | 1er pas |'))
    ).not.toBeNull()
  })

  it('CONTRE-EXEMPLE — un tableau qui n’est PAS un scout reste refusé', () => {
    expect(
      parseScoutTable(
        ['| Fichier | Lignes | Couverture |', '| --- | ---: | ---: |', '| a.ts | 120 | 98% |'].join(
          '\n'
        )
      )
    ).toBeNull()
    // Une colonne « Quoi » seule, sans score ni type, ne suffit pas à faire un scout.
    expect(
      parseScoutTable(['| Quoi | Détail |', '| --- | --- |', '| x | y |'].join('\n'))
    ).toBeNull()
  })
})
