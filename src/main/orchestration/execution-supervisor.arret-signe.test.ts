import { describe, expect, it } from 'vitest'
import { ExecutionSupervisor } from './execution-supervisor'
import { compileExecutionQuote } from './execution-quote'
import { motifArreterUnFil, interruptionSansDefaut } from '../../shared/arret-par-stop'
import { classifyProviderFailure } from '../providers/provider-failure-diagnosis'

/**
 * UN APPEL REFUSÉ SUR UN RUN DÉJÀ COUPÉ GARDE LA SIGNATURE DE L'ARRÊT.
 *
 * Relevé le 2026-11-06 : un run coupé par `arreter_un_fil` relançait son appel suivant, qui
 * échouait en 2 ms sur « arret demande par conv-1667 (arreter_un_fil) : … », nu. La réservation
 * passait par `AbortSignal.throwIfAborted()`, qui jette la raison telle quelle : sans le marqueur
 * `[abort]` que pose `abortFailure`, le diagnostic lisait une panne ordinaire (`other`).
 */
describe('reserveProviderCall — un run déjà coupé', () => {
  it('jette une erreur signée [abort] qui garde le motif entier', async () => {
    const supervisor = new ExecutionSupervisor()
    const exterieur = new AbortController()
    const motif = motifArreterUnFil('conv-1667', 'Lot 2 parti sans le code du lot 1')
    let erreur: unknown
    await supervisor.run(
      compileExecutionQuote('un lot coupé par un autre fil'),
      exterieur.signal,
      async () => {
        exterieur.abort(motif)
        try {
          supervisor.reserveProviderCall()
        } catch (e) {
          erreur = e
        }
      }
    )
    expect(erreur).toBeInstanceOf(Error)
    const message = (erreur as Error).message
    expect(message).toMatch(/^\[abort\] .* interrompu : /)
    expect(message).toContain(motif)
    expect(classifyProviderFailure(message)).toBe('cancelled')
    expect(interruptionSansDefaut(message)).toBe('arret-voulu')
  })

  it('un arrêt imposé par un plafond reste lu comme un plafond', async () => {
    const supervisor = new ExecutionSupervisor()
    const exterieur = new AbortController()
    let erreur: unknown
    await supervisor.run(
      compileExecutionQuote('un run sur son plafond'),
      exterieur.signal,
      async () => {
        exterieur.abort('Budget USD depasse (5.0000 > 4.0000)')
        try {
          supervisor.reserveProviderCall()
        } catch (e) {
          erreur = e
        }
      }
    )
    expect(classifyProviderFailure((erreur as Error).message)).toBe('budget')
    expect(interruptionSansDefaut((erreur as Error).message)).toBeUndefined()
  })
})
