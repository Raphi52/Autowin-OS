import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { dodDuVerdict } from './objections-juge'
import { arretDeLaReparation, doitArreterLaReparation, evaluateClosure } from './gates/stopgate'

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

  it("un refus << echec amont + reserves d'un VALIDE >> ne se rejoue pas indefiniment", () => {
    const g = evaluateClosure({ status: 'red', dod: dodDuVerdict(false, VERDICT), travauxNonLivres: [] })
    expect(doitArreterLaReparation(g.reasons, g.reasons)).toBe(true)

    /*
     * Objection du juge (tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f) : comparer `g.reasons` avec
     * lui-meme prouve la REGLE, pas son APPLICATION. La boucle de `orchestrator.ts` ne consulte pas
     * `doitArreterLaReparation` : elle passe par `arretDeLaReparation`, qui rend un MOTIF. On rejoue
     * donc la porte d'entree reelle, avec le meme cablage que la boucle (`motifsPrecedents` = les
     * motifs du passage precedent), puis on verifie que le fichier appelant l'utilise bien ainsi.
     */
    const motif = arretDeLaReparation({
      tentative: 1,
      reparationsAccordees: 5,
      plafondDur: 10,
      motifsCourants: g.reasons,
      motifsPrecedents: g.reasons
    })
    expect(motif, 'la boucle doit S ARRETER sur ce refus, pas seulement la regle').toContain(
      'hors de portee'.replace('portee', 'portée')
    )

    const source = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')
    expect(source).toContain('arretDeLaReparation({')
    expect(source).toContain('motifsPrecedents = [...gate.reasons]')
  })

  it('un refus reparable par build laisse la boucle continuer (meme porte d entree)', () => {
    const g = evaluateClosure({
      status: 'red',
      dod: [{ checked: false, hasContent: true, label: 'Objection du juge : test non rejoue' }],
      travauxNonLivres: []
    })
    expect(
      arretDeLaReparation({
        tentative: 1,
        reparationsAccordees: 5,
        plafondDur: 10,
        motifsCourants: g.reasons,
        motifsPrecedents: g.reasons
      })
    ).toBeUndefined()
  })

  it('un refus reparable par build continue de se rejouer', () => {
    const g = evaluateClosure({
      status: 'red',
      dod: [{ checked: false, hasContent: true, label: 'Objection du juge : test non rejoue' }],
      travauxNonLivres: []
    })
    expect(doitArreterLaReparation(g.reasons, g.reasons)).toBe(false)
  })
})
