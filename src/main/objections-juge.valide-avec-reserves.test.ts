import { describe, expect, it } from 'vitest'
import { dodDuVerdict } from './objections-juge'
import { evaluateClosure } from './gates/stopgate'

/*
 * conv-540, tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f : les 4 appels du juge (ts 09:44:57.329,
 * 09:48:05.122, 09:51:14.024, 09:53:28.437) rendent tous VALIDE 72-74. Le controle de 09:53:28.450
 * recopie pourtant 6 de leurs puces en « Promis mais pas fait », dont des constats de verification
 * REUSSIE. Le blocage doit rester (l'echec amont est reel), mais sans accuser le travail.
 */
const VERDICT = [
  'VALIDE',
  'SCORE: 74',
  'OBJECTIONS:',
  "- Le coeur de la demande n'est atteint que dans le code, pas en vrai.",
  '- Les 11 commits cites existent bien (git log), et 240 sur 240 tests passent, code de sortie 0.',
  '- Les 7 tests orchestrator.judge-* cites comme rouges passent maintenant.'
].join('\n')

describe('verdict VALIDE porteur de reserves', () => {
  it('bloque encore, mais ne transforme pas les puces en promesses non tenues', () => {
    const dod = dodDuVerdict(false, VERDICT)
    expect(dod).toHaveLength(1)
    expect(dod[0].checked).toBe(false)
    expect(dod[0].label).toMatch(/Reserves du juge sur un verdict VALIDE/)
    expect(dod.filter((d) => d.label?.startsWith('Objection du juge'))).toHaveLength(0)

    const g = evaluateClosure({ status: 'red', dod, travauxNonLivres: [] })
    expect(g.blocked).toBe(true)
    expect(g.reasons.join(' ')).toMatch(/Reserves du juge sur un verdict VALIDE/)
  })

  it('un juge qui REFUSE garde ses objections nommees une par une', () => {
    const refus = ['DEFAUT: preuve absente', 'OBJECTIONS:', '- aucune capture', '- test non rejoue'].join('\n')
    const dod = dodDuVerdict(false, refus)
    expect(dod).toHaveLength(2)
    expect(dod[0].label).toMatch(/^Objection du juge : /)
  })
})
