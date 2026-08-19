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

/**
 * DES LIGNES STRUCTURELLES DEVENAIENT DES CANDIDATS À COCHER.
 *
 * Mesuré le 2026-08-19 en pilotant l'app : le scout a répété son en-tête TROIS fois et intercalé ses
 * séparateurs Markdown. `parseScoutTable` acceptait toute ligne `|…|` suivant l'en-tête, donc le
 * panneau affichait 5 candidats pour UN seul vrai — les autres étant « Quoi » (l'intitulé de colonne)
 * et « --- » (le séparateur). J'en ai coché deux et lancé la chaîne dessus ; la phase frame a dû
 * expliquer que « les deux candidats sont des lignes structurelles du tableau, pas des sujets
 * réalisables ». Un candidat qui n'existe pas coûte un tour complet.
 *
 * Entrée du test : la forme EXACTE observée dans l'app.
 */
describe('parseScoutTable — les lignes de structure ne sont pas des candidats', () => {
  const OBSERVE = [
    '| Score | Type | Quoi | Ancrage fichier:ligne | Preuve que l appelant manque |',
    '|---:|---|---|---|---|',
    '| Score | Type | Quoi | Ancrage fichier:ligne | Preuve que l appelant manque |',
    '|---:|---|---|---|---|',
    '| Score | Type | Quoi | Ancrage fichier:ligne | Preuve que l appelant manque |',
    '|---:|---|---|---|---|',
    '| 0 | fix | Aucun export inutilisé démontré | src/shared/app-identity.ts:1 | Recherche tronquée |'
  ].join('\n')

  it('ne retient QUE la ligne de données réelle', () => {
    const rows = parseScoutTable(OBSERVE)
    expect(rows).toHaveLength(1)
    expect(rows?.[0].what).toContain('Aucun export inutilisé')
  })

  it('un séparateur intercalé ne coupe pas la lecture des lignes suivantes', () => {
    const rows = parseScoutTable(
      [
        '| Score | Type | Quoi | Ancrage | Preuve |',
        '|---:|---|---|---|---|',
        '| 92 | fix | Alpha | src/a.ts:1 | aucun appelant |',
        '| --- | --- | --- | --- | --- |',
        '| 84 | fix | Beta | src/b.ts:2 | aucun appelant |'
      ].join('\n')
    )
    expect(rows?.map((r) => r.what)).toEqual(['Alpha', 'Beta'])
  })

  it('CONTRE-EXEMPLE — une ligne dont le texte ressemble à un titre de colonne est gardée', () => {
    const rows = parseScoutTable(
      [
        '| Score | Type | Quoi | Ancrage | Preuve |',
        '|---:|---|---|---|---|',
        '| 71 | new | Colonne Score jamais alimentée | src/c.ts:3 | aucun producteur |'
      ].join('\n')
    )
    expect(rows).toHaveLength(1)
    expect(rows?.[0].what).toContain('Colonne Score')
  })
})
