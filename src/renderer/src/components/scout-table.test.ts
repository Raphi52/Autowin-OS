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

  it('reconnaît le format « Score | Type | What | Why | How » du brief scout', () => {
    const md = `Shortlist :

| Score | Type | What | Why | How |
|-------|------|------|-----|-----|
| 85 | 🔧 fix | Reprise de run coupé | crash → on refait tout | commands.ts:598 |
| 55 | 🆕 new | Mémoire de findings | fan-out aveugle | orchestrator.ts:241 |
| 20 | 🔧 fix | Nettoyage logs | bruit | logger.ts:12 |
`
    const rows = parseScoutTable(md)!
    expect(rows).toHaveLength(3)
    expect(rows[0]).toMatchObject({
      num: '1',
      impact: 'g',
      effort: null,
      type: 'fix',
      what: 'Reprise de run coupé',
      how: 'commands.ts:598'
    })
    expect(rows[1].impact).toBe('y')
    expect(rows[2].impact).toBe('r')
  })

  it('un tableau markdown SANS colonnes impact/effort → null (pas un scout)', () => {
    const md = '| Nom | Valeur |\n|---|---|\n| a | 1 |'
    expect(parseScoutTable(md)).toBeNull()
  })

  it('du texte normal sans tableau → null', () => {
    expect(parseScoutTable('Voici mon analyse.\nDeux points.')).toBeNull()
  })
})
