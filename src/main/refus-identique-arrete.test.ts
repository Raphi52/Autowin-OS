import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UNE RÉPARATION QUI NE CHANGE RIEN NE DOIT PAS ÊTRE REJOUÉE.
 *
 * Mesuré dans `conv-1242` le 2026-08-15, en rejouant le journal d'évènements du tour :
 *
 *   exec → gate BLOQUÉ · exec (73 s) → gate BLOQUÉ · exec (60 s) → gate BLOQUÉ · abandon
 *
 * Trois passages `build`, et à chaque fois le MÊME refus mot pour mot : « PRÉ-GATE BLOQUÉ:
 * Statut "red" : la clôture a été refusée en amont ». Plus de deux minutes de calcul brûlées pour
 * rien. Le run était rouge EN AMONT — aucune réparation du livrable ne pouvait lever ce verrou.
 *
 * La réparation n'a de sens que si le refus ÉVOLUE : un motif nouveau prouve qu'on a avancé, un
 * motif inchangé prouve l'inverse. Ce test tient la boucle, pas le style du message.
 */
const source = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')

describe('boucle de réparation : arrêt sur refus identique', () => {
  it('COMPARE le motif du refus à celui de la tentative précédente', () => {
    const compact = source.replace(/\s+/g, ' ')
    expect(compact).toContain('motifCourant === motifPrecedent')
  })

  it('ARRÊTE la boucle au lieu de rejouer un passage identique', () => {
    // Sans le `break`, la comparaison ne servirait à rien : on paierait quand même la tentative.
    const compact = source.replace(/\s+/g, ' ')
    const zone = compact.slice(compact.indexOf('motifCourant === motifPrecedent'))
    expect(zone.slice(0, 400)).toContain('break')
  })

  it('DIT pourquoi il s’arrête, au lieu d’un abandon muet', () => {
    // Un arrêt silencieux reproduirait le défaut central de la journée : un échec qui ne s'explique pas.
    expect(source).toContain('le refus est identique a la tentative precedente')
  })

  it('n’interrompt PAS une boucle dont le refus CHANGE', () => {
    // Un motif nouveau prouve une progression : la réparation garde alors tout son sens.
    const compact = source.replace(/\s+/g, ' ')
    expect(compact).toContain('motifPrecedent = motifCourant')
  })
})
