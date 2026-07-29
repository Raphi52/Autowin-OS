import { describe, expect, it } from 'vitest'
import { parseScoutTable, scoreBand } from './scout-table'

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

  // MINEUR 3a : une petite table de legende AVANT la shortlist faisait perdre tout le rendu — on ne
  // prenait que le PREMIER candidat `/score/i` + `/what|type/i` et on rendait null si son i+1 n'etait
  // pas un separateur. Il faut iterer sur TOUS les candidats.
  it('une table de legende avant la vraie shortlist ne casse plus le rendu', () => {
    const md = `Legende :

| Score | Type |
| Sens de la colonne | fix ou new |

| Score | Type | What | Why | How |
|-------|------|------|-----|-----|
| 85 | 🔧 fix | Reprise de run coupé | crash → on refait tout | commands.ts:598 |
`
    const rows = parseScoutTable(md)
    expect(rows).not.toBeNull()
    expect(rows).toHaveLength(1)
    expect(rows![0]).toMatchObject({ impact: 'g', what: 'Reprise de run coupé' })
  })

  // MINEUR 3b : risque INVERSE — un tableau ETRANGER etait capture a tort ; `what`/`why`/`how` absents,
  // toutes les colonnes sauf la 2e etaient jetees et le contenu re-presente comme une shortlist.
  it('un tableau etranger « Dimension | Score | Type | Note » → null', () => {
    const md = `| Dimension | Score | Type | Note |
|---|---|---|---|
| Lisibilité | 72 | qualitatif | correct |
| Robustesse | 40 | qualitatif | fragile |
`
    expect(parseScoutTable(md)).toBeNull()
  })

  // MINEUR 2 : `cell.match(/\d+/)` prenait le premier entier sans echelle.
  it('scoreBand lit une echelle explicite au lieu du premier entier', () => {
    expect(scoreBand('8/10')).toBe('g')
    expect(scoreBand('3/10')).toBe('r')
    expect(scoreBand('#3 — 82')).toBe('g')
    expect(scoreBand('85')).toBe('g')
    expect(scoreBand('55')).toBe('y')
    expect(scoreBand('20')).toBe('r')
    expect(scoreBand('72 %')).toBe('g')
  })

  it('scoreBand rend null plutot qu’une pastille fausse quand ce n’est pas interpretable', () => {
    expect(scoreBand('')).toBeNull()
    expect(scoreBand('élevé')).toBeNull()
    expect(scoreBand('8')).toBeNull()
    expect(scoreBand('82 (cf. 3 refs)')).toBeNull()
    expect(scoreBand('120')).toBeNull()
  })
})
