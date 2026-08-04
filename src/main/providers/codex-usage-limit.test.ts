import { describe, expect, it } from 'vitest'
import { CodexStructuralFailure, codexStructuralFailure } from './codex'

/**
 * UN QUOTA ÉPUISÉ N'ÉTAIT PAS RECONNU COMME NON TRANSITOIRE — donc l'orchestrateur continuait à tirer.
 *
 * Mesuré le 2026-08-04 sur le journal de prompts réel : 410 tours en échec, dont **310 pour le seul
 * quota codex** (182 en phase kaizen, 128 en phase build), tous portant « You've hit your usage limit
 * … try again at Aug 8th ». Le garde existait (`admitProviderCall` bloque un provider sur une
 * `structuralProviderFailure`) mais ne voyait rien : seules deux signatures étaient classées non
 * transitoires. 310 appels ont donc été lancés dans un quota mort, chacun payant sa latence pour rien.
 *
 * Un quota qui se réinitialise dans plusieurs JOURS est l'archétype du non transitoire : le relancer
 * sans changer de provider est inutile, ce que la classe affirme déjà dans sa propre docstring.
 */
describe('codex — quota épuisé classé non transitoire', () => {
  it('reconnaît le message de quota réel remonté par le provider', () => {
    const reel =
      'codex exec échec | exit-code=1 | last-event={"type":"turn.failed","error":{"message":' +
      '"You\'ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more ' +
      'credits or try again at Aug 8th, 2026 7:20 AM."}}'
    const erreur = codexStructuralFailure(new Error(reel))
    expect(erreur).toBeInstanceOf(CodexStructuralFailure)
    expect((erreur as CodexStructuralFailure).signature).toBe('usage-limit-reached')
  })

  it('reconnaît la forme JSON courte du même refus', () => {
    const erreur = codexStructuralFailure(
      new Error('codex responses HTTP 429 — {"error":{"type":"usage_limit_reached"}}')
    )
    expect(erreur).toBeInstanceOf(CodexStructuralFailure)
  })

  /**
   * LA FRONTIÈRE, dans le sens qui coûte cher : un rate-limit PASSAGER (« réessaie dans 20 s ») ne doit
   * PAS bloquer le provider pour tout le run. Bloquer là-dessus transformerait une micro-attente en
   * panne de provider — l'excès de zèle inverse du défaut mesuré.
   */
  it('ne bloque PAS sur un rate-limit passager', () => {
    const erreur = codexStructuralFailure(
      new Error('codex responses HTTP 429 — rate limit exceeded, please retry after 20 seconds')
    )
    expect(erreur).not.toBeInstanceOf(CodexStructuralFailure)
  })

  it('ne bloque pas sur une erreur réseau ordinaire', () => {
    const erreur = codexStructuralFailure(new Error('socket hang up'))
    expect(erreur).not.toBeInstanceOf(CodexStructuralFailure)
  })

  it('laisse intactes les deux signatures préexistantes', () => {
    expect(
      (
        codexStructuralFailure(
          new Error('Unexpected trailing characters')
        ) as CodexStructuralFailure
      ).signature
    ).toBe('json-trailing-characters')
    expect(
      (
        codexStructuralFailure(
          new Error('unknown field supports_reasoning_summaries')
        ) as CodexStructuralFailure
      ).signature
    ).toBe('missing-supports-reasoning-summaries')
  })
})
