import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * UNE RÉPARATION AUTORISÉE PAR LE DEVIS DOIT ÊTRE REJOUÉE JUSQU'AU SUCCÈS OU À SA BORNE.
 *
 * Mesuré dans `conv-1242` le 2026-08-15, en rejouant le journal d'évènements du tour :
 *
 *   exec → gate BLOQUÉ · exec (73 s) → gate BLOQUÉ · exec (60 s) → gate BLOQUÉ · abandon
 *
 * Trois passages `build`, et à chaque fois le MÊME refus mot pour mot : « PRÉ-GATE BLOQUÉ:
 * Statut "red" : la clôture a été refusée en amont ». Plus de deux minutes de calcul brûlées pour
 * rien. Le run était rouge EN AMONT — aucune réparation du livrable ne pouvait lever ce verrou.
 *
 * Un motif identique ne prouve pas que la prochaine tentative échouera : une dépendance ou une
 * preuve peut devenir disponible entre deux passages. Le devis reste la borne de sécurité.
 */
const source = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')

describe('boucle de réparation : refus identique', () => {
  it('NE COUPE PAS avant le succès ou la borne du devis', () => {
    const compact = source.replace(/\s+/g, ' ')
    expect(compact).not.toContain('motifCourant === motifPrecedent')
  })
})
