import { describe, expect, it } from 'vitest'
import { assembler, pagesDuLot } from './sql-resultat-vers-fichier.mjs'

/**
 * Le script relit le journal stream-json de la session et rassemble les pages d'un lot `sql_query`.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER CE TEST : une page tronquée acceptée, une page manquante
 * acceptée, une colonne aw_* laissée dans la sortie, un résultat d'un autre lot mélangé au lot demandé.
 */

function ligneJournal(id, resultat, forme = 'tableau') {
  const texte = JSON.stringify(resultat)
  const content = forme === 'tableau' ? [{ type: 'text', text: texte }] : texte
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ tool_use_id: id, type: 'tool_result', content }] }
  })
}

const page = (lot, n, lignes, truncated = false) => ({
  ok: true,
  rows: lignes.map((l) => ({ ...l, aw_lot: lot, aw_page: n })),
  rowCount: lignes.length,
  truncated
})

describe('pagesDuLot', () => {
  it('ne garde que le lot demandé, sous les deux formes de contenu', () => {
    const journal = [
      ligneJournal('a', page('avocats', 1, [{ id: 1 }, { id: 2 }])),
      ligneJournal('b', page('etats', 1, [{ code: 'X' }]), 'chaine'),
      ligneJournal('c', page('avocats', 2, [{ id: 3 }]), 'chaine'),
      '{ligne illisible'
    ].join('\n')
    const pages = pagesDuLot(journal, 'avocats')
    expect([...pages.keys()].sort()).toEqual([1, 2])
    expect(assembler(pages)).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }])
  })

  it('une page relue plus tard remplace la première lecture', () => {
    const journal = [
      ligneJournal('a', page('lot', 1, [{ v: 'ancienne' }])),
      ligneJournal('b', page('lot', 1, [{ v: 'nouvelle' }]))
    ].join('\n')
    expect(assembler(pagesDuLot(journal, 'lot'))).toEqual([{ v: 'nouvelle' }])
  })

  it('ignore un résultat en échec', () => {
    const journal = ligneJournal('a', { ok: false, reason: 'refus', rows: [{ aw_lot: 'lot' }] })
    expect(pagesDuLot(journal, 'lot').size).toBe(0)
  })
})

describe('assembler', () => {
  it('refuse une page tronquée (code 4)', () => {
    const pages = pagesDuLot(ligneJournal('a', page('lot', 1, [{ id: 1 }], true)), 'lot')
    expect(() => assembler(pages)).toThrow(expect.objectContaining({ code: 4 }))
  })

  it('refuse une page manquante (code 5)', () => {
    const journal = [
      ligneJournal('a', page('lot', 1, [{ id: 1 }])),
      ligneJournal('b', page('lot', 3, [{ id: 3 }]))
    ].join('\n')
    expect(() => assembler(pagesDuLot(journal, 'lot'))).toThrow(
      expect.objectContaining({ code: 5 })
    )
  })

  it('retire les colonnes de marquage et garde les valeurs telles quelles', () => {
    const pages = pagesDuLot(
      ligneJournal('a', page('lot', 1, [{ id: 7, actif: true, nom: 'Ç é' }])),
      'lot'
    )
    expect(assembler(pages)).toEqual([{ id: 7, actif: true, nom: 'Ç é' }])
  })
})
