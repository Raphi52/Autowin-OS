import { describe, expect, it, vi } from 'vitest'
import { ATTENTE_MAX_MS, attendreLeReglageDesAppels } from './attente-de-reglage'
import type { ExecutionUsageSnapshot } from './execution-supervisor'

const etat = (activeCalls: number): ExecutionUsageSnapshot =>
  ({ quoteId: 'q1', activeCalls }) as ExecutionUsageSnapshot

/** Horloge qui avance du temps DEMANDE : l'attente est mesuree sans etre subie. */
function horloge(): { maintenant: () => number; sleep: (ms: number) => Promise<void> } {
  let t = 0
  return {
    maintenant: () => t,
    sleep: async (ms: number) => {
      t += ms
    }
  }
}

describe('attendre qu un appel en vol se regle avant de refuser la reprise', () => {
  it('rend l etat relu des que l appel se regle — la reprise passe', async () => {
    const h = horloge()
    const relire = vi
      .fn<() => ExecutionUsageSnapshot>()
      .mockReturnValueOnce(etat(1))
      .mockReturnValueOnce(etat(0))
    const rendu = await attendreLeReglageDesAppels(etat(1), { relire, ...h })
    expect(rendu?.activeCalls).toBe(0)
    expect(relire).toHaveBeenCalledTimes(2)
  })

  it('rend l etat ENCORE actif passe le plafond : le refus part, inchange', async () => {
    const h = horloge()
    const relire = vi.fn(() => etat(1))
    const rendu = await attendreLeReglageDesAppels(etat(1), { relire, ...h })
    expect(rendu?.activeCalls).toBe(1)
    expect(h.maintenant()).toBeGreaterThanOrEqual(ATTENTE_MAX_MS)
  })

  it('n attend PAS quand rien n est en vol — aucun tour ralenti pour rien', async () => {
    const relire = vi.fn(() => etat(0))
    expect(await attendreLeReglageDesAppels(etat(0), { relire })).toEqual(etat(0))
    expect(relire).not.toHaveBeenCalled()
  })

  it('sans relecture cablee, le comportement historique est conserve a l identique', async () => {
    const depart = etat(1)
    expect(await attendreLeReglageDesAppels(depart)).toBe(depart)
  })

  it('un Stop pendant l attente rend la main tout de suite', async () => {
    const h = horloge()
    const relire = vi.fn(() => etat(1))
    const rendu = await attendreLeReglageDesAppels(etat(1), {
      relire,
      ...h,
      signal: AbortSignal.abort()
    })
    expect(relire).not.toHaveBeenCalled()
    expect(rendu?.activeCalls).toBe(1)
  })

  it('un checkpoint illisible ne fait pas accuser : on retente au pas suivant', async () => {
    const h = horloge()
    const relire = vi
      .fn<() => ExecutionUsageSnapshot>()
      .mockImplementationOnce(() => {
        throw new Error('checkpoint illisible')
      })
      .mockReturnValueOnce(etat(0))
    expect((await attendreLeReglageDesAppels(etat(1), { relire, ...h }))?.activeCalls).toBe(0)
  })
})
