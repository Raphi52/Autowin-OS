import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { TrustLedger } from './trust/ledger'

/**
 * LA VERITE HUMAINE N'AVAIT AUCUN CHEMIN D'ECRITURE.
 *
 * trust.jsonl portait 186 verdicts {judgeModel, verdict}, sans date, sans run, sans humanTruth.
 * `calibration()` ignorant tout verdict non confirme, le taux de faux-verts etait structurellement
 * incalculable et `ranking()` classait des juges sans mesure. Cette commande est le seul point
 * d'entree de cette verite.
 */
describe('confirmer_verdict_juge', () => {
  const busAvecLedger = () => {
    const trust = new TrustLedger()
    const os = {
      confirmerVerdictJuge: (runId: string, verite: 'green' | 'red') =>
        trust.confirmer(runId, verite)
    } as never
    return { bus: new AppCommandBus(os, () => {}), trust }
  }

  it('rend accuracy calculable pour le juge du run confirme', async () => {
    const { bus, trust } = busAvecLedger()
    trust.record({ judgeModel: 'claude', verdict: 'green', runId: 'run-1' })
    expect(trust.calibration('claude').accuracy).toBeNull()

    const res = await bus.exec('confirmer_verdict_juge', { runId: 'run-1', verite: 'red' })

    expect(res).toMatchObject({
      ok: true,
      data: { runId: 'run-1', verite: 'red', reetiquetes: 1, connu: true }
    })
    expect(trust.calibration('claude')).toMatchObject({ confirmed: 1, falseGreen: 1, accuracy: 0 })
  })

  it('rend 0 sans lever sur un run inconnu', async () => {
    const { bus } = busAvecLedger()
    const res = await bus.exec('confirmer_verdict_juge', { runId: 'run-absent', verite: 'green' })
    expect(res).toMatchObject({ ok: true, data: { reetiquetes: 0, connu: false } })
  })

  it('refuse une verite hors du vocabulaire green/red', async () => {
    const { bus } = busAvecLedger()
    const res = await bus.exec('confirmer_verdict_juge', { runId: 'run-1', verite: 'bof' })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res)).toMatch(/green.*red|verite/i)
  })
})
