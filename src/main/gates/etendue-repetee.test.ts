import { describe, expect, it } from 'vitest'
import {
  CONTRAT_ETENDUE,
  consigneDeDecisionDEtendue,
  doitTrancherLEtendue,
  ligneDeDecisionDEtendue,
  objectionDEtendue
} from './etendue-repetee'

/*
 * OBJECTION D'ÉTENDUE RÉPÉTÉE EN MODE JUSQU'AU VERT (2026-10-25).
 *
 * Cas (run-ec2036c0932d-1) : le juge a refusé QUATRE fois de suite « Ta demande n'est pas
 * remplie. Tu as écrit « full anglais » » ; chaque refus relançait une réparation qui traduisait de
 * nouveaux écrans (33 $, 22 $, 16 $ pour les réparations 4, 8 et 11), sans que personne ne décide
 * s'il fallait tout livrer ou livrer par étapes.
 */
const verdict = (puce: string): string =>
  ['DEFAUT: demande pas remplie', 'SCORE: 40', 'OBJECTIONS:', `- ${puce}`].join('\n')

describe('le contrat : le juge marque une objection d’étendue', () => {
  it('nomme le préfixe « ÉTENDUE — » et le réserve à une partie de la demande non faite', () => {
    expect(CONTRAT_ETENDUE).toContain('ÉTENDUE —')
    expect(CONTRAT_ETENDUE).toMatch(/PARTIE de la demande/)
  })
})

describe('objectionDEtendue', () => {
  it('lit une objection bloquante marquée ÉTENDUE (MAJEUR ou MINEUR, accent ou non)', () => {
    expect(
      objectionDEtendue(verdict('MAJEUR: ÉTENDUE — 110 écrans sur 113 restent en français'))
    ).toBe('ÉTENDUE — 110 écrans sur 113 restent en français')
    expect(objectionDEtendue(verdict('MINEUR: Etendue - le chat reste en français'))).toBeTruthy()
  })

  it('ignore une objection ordinaire, une puce OK et un verdict vide', () => {
    expect(objectionDEtendue(verdict('MAJEUR: le test de la langue est absent'))).toBeUndefined()
    expect(objectionDEtendue(verdict('OK: ÉTENDUE — couverte'))).toBeUndefined()
    expect(objectionDEtendue('')).toBeUndefined()
  })
})

describe('doitTrancherLEtendue', () => {
  const base = { jusquAuVert: true, dejaTranchee: false, courante: 'a', precedente: 'b' }
  it('tranche quand deux verdicts du juge d’affilée portent une objection d’étendue', () => {
    expect(doitTrancherLEtendue(base)).toBe(true)
  })
  it('ne tranche pas hors jusqu’au vert, au premier constat, ni une seconde fois dans le run', () => {
    expect(doitTrancherLEtendue({ ...base, jusquAuVert: false })).toBe(false)
    expect(doitTrancherLEtendue({ ...base, precedente: undefined })).toBe(false)
    expect(doitTrancherLEtendue({ ...base, courante: undefined })).toBe(false)
    expect(doitTrancherLEtendue({ ...base, dejaTranchee: true })).toBe(false)
  })
})

/*
 * PLUS DE FENÊTRE DE QUESTION (2026-11-08, demande de l'utilisateur) : la réparation suivante
 * reçoit l'ordre de trancher elle-même par une phrase `Décision :`, avec un inventaire en lecture
 * seule d'abord si elle ne sait pas ce qui reste. Le parcours complet est rejoué dans
 * `orchestrator.etendue-repetee.test.ts`.
 */
describe('consigneDeDecisionDEtendue et ligneDeDecisionDEtendue', () => {
  const objection = 'ÉTENDUE — 110 écrans restent en français'

  it('porte l’objection, l’ordre de trancher et la phrase de décision attendue', () => {
    const consigne = consigneDeDecisionDEtendue(objection)
    expect(consigne).toContain('110 écrans restent en français')
    expect(consigne).toContain('ne la pose pas, tranche')
    expect(consigne).toContain('`Décision : <ce que ce passage couvre')
    expect(consigne).toContain('inventaire en lecture seule')
  })

  it('la trace dit qu’il n’y a pas de pause, et borne l’objection', () => {
    expect(ligneDeDecisionDEtendue(objection)).toContain('pas de pause')
    expect(ligneDeDecisionDEtendue(`ÉTENDUE — ${'x'.repeat(900)}`).length).toBeLessThan(400)
  })
})
