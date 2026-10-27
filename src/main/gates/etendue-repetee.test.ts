import { describe, expect, it } from 'vitest'
import {
  CONTRAT_ETENDUE,
  OPTION_ARRETER,
  OPTION_CONTINUER,
  doitDemanderLEtendue,
  issueDeLaReponse,
  objectionDEtendue,
  questionDEtendue
} from './etendue-repetee'

/*
 * OBJECTION D'ÉTENDUE RÉPÉTÉE EN MODE JUSQU'AU VERT → PAUSE ET QUESTION (conv-1149, 2026-10-25).
 *
 * Cas conv-1146 (run-ec2036c0932d-1) : le juge a refusé QUATRE fois de suite « Ta demande n'est pas
 * remplie. Tu as écrit « full anglais » » ; chaque refus relançait une réparation qui traduisait de
 * nouveaux écrans (33 $, 22 $, 16 $ pour les réparations 4, 8 et 11). Livrer tout ou par étapes est
 * un choix de l'utilisateur, pas du juge ni du build.
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

describe('doitDemanderLEtendue', () => {
  const base = { jusquAuVert: true, dejaTranchee: false, courante: 'a', precedente: 'b' }
  it('demande quand deux verdicts du juge d’affilée portent une objection d’étendue', () => {
    expect(doitDemanderLEtendue(base)).toBe(true)
  })
  it('ne demande pas hors jusqu’au vert, au premier constat, ni une seconde fois dans le run', () => {
    expect(doitDemanderLEtendue({ ...base, jusquAuVert: false })).toBe(false)
    expect(doitDemanderLEtendue({ ...base, precedente: undefined })).toBe(false)
    expect(doitDemanderLEtendue({ ...base, courante: undefined })).toBe(false)
    expect(doitDemanderLEtendue({ ...base, dejaTranchee: true })).toBe(false)
  })
})

describe('questionDEtendue et issueDeLaReponse', () => {
  it('pose la question avec deux boutons, l’objection et la demande en contexte', () => {
    const q = questionDEtendue('ÉTENDUE — 110 écrans restent en français')
    expect(q.options).toEqual([OPTION_CONTINUER, OPTION_ARRETER])
    expect(q.text).toContain('110 écrans restent en français')
    expect(q.reason).toBe('material-ambiguity')
  })

  it('continuer → réparation suivante ; arrêter → arrêt nommé ; texte libre → consigne', () => {
    expect(issueDeLaReponse(OPTION_CONTINUER)).toEqual({ kind: 'continuer' })
    const arret = issueDeLaReponse(OPTION_ARRETER)
    expect(arret.kind).toBe('arreter')
    expect(issueDeLaReponse('seulement le chat et Settings')).toEqual({
      kind: 'consigne',
      texte: 'seulement le chat et Settings'
    })
  })

  it('aucune réponse possible (fenêtre fermée, aucune fenêtre) → arrêt, jamais une relance', () => {
    expect(issueDeLaReponse(undefined).kind).toBe('arreter')
    expect(issueDeLaReponse('attend pour l’instant').kind).toBe('arreter')
    expect(issueDeLaReponse('   ').kind).toBe('arreter')
  })
})
