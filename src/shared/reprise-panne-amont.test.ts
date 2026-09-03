import { describe, expect, it, vi } from 'vitest'
import { DELAIS_REPRISE_MS, MAX_REPRISES, reprendreApresPanneAmont } from './reprise-panne-amont'

type Res = { ok: boolean; error?: string }
const panne: Res = { ok: false, error: 'overloaded_error' }
const bon: Res = { ok: true }

function outils(reponses: Res[], extra: Record<string, unknown> = {}) {
  let n = 0
  const attentes: number[] = []
  const copier = vi.fn(async () => `copie-${n + 1}`)
  const renvoyer = vi.fn(async () => reponses[n++] ?? panne)
  return {
    attentes,
    copier,
    renvoyer,
    deps: {
      copier,
      renvoyer,
      estPanneAmont: (r: Res) => !r.ok && r.error === 'overloaded_error',
      attendre: async (ms: number) => {
        attentes.push(ms)
      },
      ...extra
    }
  }
}

describe('reprise après une panne du fournisseur', () => {
  it('rejoue dans une copie et rend la main dès qu une tentative aboutit', async () => {
    const o = outils([bon])
    const issue = await reprendreApresPanneAmont(o.deps)
    expect(issue).toEqual({
      issue: 'reprise',
      conversationId: 'copie-1',
      resultat: bon,
      tentatives: 1
    })
    expect(o.copier).toHaveBeenCalledTimes(1)
    expect(o.attentes).toEqual([DELAIS_REPRISE_MS[0]])
  })

  it('s arrête à 3 tentatives et NE masque pas la panne', async () => {
    const o = outils([panne, panne, panne, bon])
    const issue = await reprendreApresPanneAmont(o.deps)
    expect(issue).toEqual({ issue: 'epuisee', tentatives: MAX_REPRISES })
    expect(o.renvoyer).toHaveBeenCalledTimes(3)
    expect(o.attentes).toEqual([...DELAIS_REPRISE_MS])
  })

  it('prend une copie NEUVE à chaque tentative (la précédente porte déjà la demande ratée)', async () => {
    const o = outils([panne, bon])
    const issue = await reprendreApresPanneAmont(o.deps)
    expect(issue).toMatchObject({ issue: 'reprise', conversationId: 'copie-2', tentatives: 2 })
    expect(o.renvoyer.mock.calls.map((c) => c[0])).toEqual(['copie-1', 'copie-2'])
  })

  it('n insiste pas si la copie est refusée', async () => {
    const copier = vi.fn(async () => undefined)
    const renvoyer = vi.fn(async () => bon)
    const issue = await reprendreApresPanneAmont({
      copier,
      renvoyer,
      estPanneAmont: () => true,
      attendre: async () => {}
    })
    expect(issue).toEqual({ issue: 'impossible', tentatives: 0 })
    expect(renvoyer).not.toHaveBeenCalled()
  })

  it('n insiste pas si l utilisateur a abandonné pendant l attente', async () => {
    let abandon = false
    const o = outils([bon], {
      abandonne: () => abandon,
      attendre: async () => {
        abandon = true
      }
    })
    const issue = await reprendreApresPanneAmont(o.deps)
    expect(issue).toEqual({ issue: 'impossible', tentatives: 0 })
    expect(o.copier).not.toHaveBeenCalled()
  })

  it('laisse remonter une exception au lieu de la transformer en silence', async () => {
    const o = outils([bon], {
      renvoyer: async () => {
        throw new Error('canal coupé')
      }
    })
    await expect(reprendreApresPanneAmont(o.deps)).rejects.toThrow('canal coupé')
  })
})
