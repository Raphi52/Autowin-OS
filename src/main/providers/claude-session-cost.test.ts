import { describe, expect, it } from 'vitest'
import {
  perTurnCostUsd,
  purgeSessionCostStates,
  SESSION_COST_TTL_MS
} from './claude-session-cost'

/**
 * SERIE REELLE mesuree le 2026-09-20 dans `prompt-observability/conv-733.jsonl` : 16 tours d'UNE
 * seule session CLI reprise. La colonne brute est strictement croissante — c'est le cumul de la
 * session — et l'indicateur de la barre du haut l'additionnait, affichant 415,77 $ pour 51,27 $
 * reellement depenses.
 */
const CUMULS_CONV_733 = [
  5.477169, 8.057443, 9.6476615, 11.0401165, 14.203086, 17.24467, 19.5296745, 21.72314,
  25.805371, 28.1937355, 31.0950725, 37.5315195, 41.923062, 45.201047, 47.822337, 51.270081
]

describe('coût par tour depuis le cumul de session', () => {
  it('rend le cumul tel quel au premier tour d’une session inconnue', () => {
    expect(perTurnCostUsd(5.477169, undefined)).toBeCloseTo(5.477169, 9)
  })

  it('rend la DIFFÉRENCE sur une session déjà vue', () => {
    expect(perTurnCostUsd(8.057443, { lastTotalUsd: 5.477169, updatedAt: 0 })).toBeCloseTo(
      2.580274,
      9
    )
  })

  it('somme la série réelle de conv-733 à la dépense réelle, pas au cumul additionné', () => {
    let dernier: number | undefined
    let total = 0
    for (const cumul of CUMULS_CONV_733) {
      total += perTurnCostUsd(
        cumul,
        dernier === undefined ? undefined : { lastTotalUsd: dernier, updatedAt: 0 }
      )
      dernier = cumul
    }
    // Le total d'une serie cumulative de-cumulee vaut son DERNIER terme.
    expect(total).toBeCloseTo(51.270081, 6)
    // Et surtout : plus la somme brute, qui etait affichee a l'ecran.
    expect(CUMULS_CONV_733.reduce((a, b) => a + b, 0)).toBeCloseTo(415.765, 2)
  })

  it('ne rend jamais de négatif quand le cumul repart en arrière', () => {
    expect(perTurnCostUsd(2, { lastTotalUsd: 40, updatedAt: 0 })).toBe(2)
  })

  it('rend 0 sur une valeur non exploitable plutôt qu’un NaN qui polluerait le total', () => {
    expect(perTurnCostUsd(Number.NaN, undefined)).toBe(0)
    expect(perTurnCostUsd(-3, undefined)).toBe(0)
  })

  it('purge les sessions plus vieilles que le TTL et garde les vivantes', () => {
    const maintenant = 1_000_000_000_000
    const restant = purgeSessionCostStates(
      {
        vieille: { lastTotalUsd: 10, updatedAt: maintenant - SESSION_COST_TTL_MS - 1 },
        vivante: { lastTotalUsd: 3, updatedAt: maintenant - 1000 }
      },
      maintenant
    )
    expect(Object.keys(restant)).toEqual(['vivante'])
  })
})
