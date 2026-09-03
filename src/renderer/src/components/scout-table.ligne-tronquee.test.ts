import { describe, expect, it } from 'vitest'
import { parseScoutTable } from './scout-table'

/**
 * UN CANDIDAT TRONQUÉ EST DEVENU COCHABLE, ET A COÛTÉ UN TOUR DE FRAME.
 *
 * Mesuré le 2026-08-27 (conv-1475) : le prompt émis par le bouton du panneau de sélection portait un
 * 7e candidat dont le « Pourquoi » s'arrêtait en plein mot — « chaque onglet visité reste MONTÉ dan ».
 * La consigne finale du prompt, elle, était bien présente : la coupure n'était donc pas dans
 * `redigerPromptWorkflowSelection` (aucun `slice` sur le contenu) mais dans la DONNÉE.
 *
 * Cause : `isTableRow` acceptait une ligne sur son SEUL `|` d'ouverture, et le repli `at(idx, '')`
 * remplissait de vides les colonnes absentes. La dernière ligne d'un tableau coupé par un stream
 * interrompu entrait donc dans le panneau, incomplète et SANS AUCUN SIGNAL.
 *
 * Une ligne dont le nombre de cellules n'atteint pas celui de l'en-tête est INCOMPLÈTE : elle est
 * écartée. Mieux vaut six candidats entiers qu'un septième amputé qu'on croit lisible.
 */
describe('parseScoutTable — une ligne INCOMPLÈTE n’est pas un candidat', () => {
  const entete = ['| # | Score | Type | Quoi | Pourquoi | Comment |', '|---|---:|---|---|---|---|']

  it('écarte la dernière ligne coupée en plein mot par un stream interrompu', () => {
    const rows = parseScoutTable(
      [
        ...entete,
        '| 1 | 84 | fix | Batcher les deltas | re-rendu par token | réutiliser le batcher |',
        '| 2 | 40 | new | Vues jamais démontées | chaque onglet visité reste MONTÉ dan'
      ].join('\n')
    )
    expect(rows).toHaveLength(1)
    expect(rows?.[0].what).toContain('Batcher les deltas')
  })

  it('une ligne complète mais NON terminée par un pipe reste acceptée', () => {
    const rows = parseScoutTable(
      [
        ...entete,
        '| 1 | 84 | fix | Alpha | parce que | premier pas',
        '| 2 | 40 | new | Beta | parce que | premier pas |'
      ].join('\n')
    )
    expect(rows?.map((r) => r.what)).toEqual(['Alpha', 'Beta'])
  })

  it('CONTRE-EXEMPLE — une cellule VIDE en fin de ligne ne rend pas la ligne incomplète', () => {
    const rows = parseScoutTable(
      [...entete, '| 1 | 84 | fix | Alpha | parce que |  |'].join('\n')
    )
    expect(rows).toHaveLength(1)
    expect(rows?.[0].how).toBe('')
  })
})
