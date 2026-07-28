import { describe, expect, it } from 'vitest'
import { parseScoutTable } from './scout-table'

const SCOUT = `Voici la shortlist :

| # | Impact | Effort | Type | Manquement | Pourquoi | 1er pas |
|---|--------|--------|------|------------|----------|---------|
| 1 | 🟢 | 🟡 | 🔧 fix | Aucune reprise d'un run coupé | crash/quota → on refait tout | commands.ts:598 |
| 2 | 🟢 | 🟡 | 🔧 fix | Ré-injection redondante | system ré-envoyé en plein | orchestrator.ts:460 |
| 3 | 🟡 | 🟢 | 🆕 new | Mémoire de findings partagée | fan-out aveugle | orchestrator.ts:241 |

Bold : …`

describe('parseScoutTable', () => {
  it('parse un tableau scout markdown en lignes structurées', () => {
    const rows = parseScoutTable(SCOUT)
    expect(rows).not.toBeNull()
    expect(rows).toHaveLength(3)
    expect(rows![0]).toMatchObject({
      num: '1',
      impact: 'g',
      effort: 'y',
      type: 'fix',
      what: "Aucune reprise d'un run coupé",
      why: 'crash/quota → on refait tout',
      how: 'commands.ts:598'
    })
  })

  it('mappe les pastilles impact/effort et le type', () => {
    const rows = parseScoutTable(SCOUT)!
    expect(rows[2]).toMatchObject({ impact: 'y', effort: 'g', type: 'new' })
  })

  it('un tableau markdown SANS colonnes impact/effort → null (pas un scout)', () => {
    const md = '| Nom | Valeur |\n|---|---|\n| a | 1 |'
    expect(parseScoutTable(md)).toBeNull()
  })

  it('du texte normal sans tableau → null', () => {
    expect(parseScoutTable('Voici mon analyse.\nDeux points.')).toBeNull()
  })
})
