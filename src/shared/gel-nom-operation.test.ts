import { describe, expect, it } from 'vitest'
import { nommerOperationDuGel, type AccesCumule } from './gel-detector'

/**
 * Contributeurs tels que `gels.jsonl` les porte REELLEMENT sur les gels anonymes du 2026-09-09 :
 * la ligne dit `operation: 'inconnu'` alors que l'accumulation nomme l'appel bloquant.
 */
const accumulationReelle: AccesCumule[] = [
  { operation: 'execFileSync git config', cumulMs: 7940, appels: 1 },
  { operation: 'readFileSync', cumulMs: 120, appels: 34 }
]

describe('nommer l operation d un gel', () => {
  it('promeut le contributeur le plus couteux quand rien n est declare', () => {
    expect(nommerOperationDuGel('inconnu', accumulationReelle)).toBe('execFileSync git config')
  })

  it('n ecrase JAMAIS une operation deja declaree', () => {
    expect(nommerOperationDuGel('ipc:os:conversations', accumulationReelle)).toBe(
      'ipc:os:conversations'
    )
  })

  it('reste « inconnu » quand l accumulation est vide ou absente — aucune accusation inventee', () => {
    expect(nommerOperationDuGel('inconnu', undefined)).toBe('inconnu')
    expect(nommerOperationDuGel('inconnu', [])).toBe('inconnu')
  })

  it('ignore un contributeur au nom vide et prend le suivant', () => {
    expect(
      nommerOperationDuGel('inconnu', [
        { operation: '   ', cumulMs: 900, appels: 2 },
        { operation: 'appendFileSync', cumulMs: 800, appels: 1 }
      ])
    ).toBe('appendFileSync')
  })
})
