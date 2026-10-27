import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'
import { dodDuVerdict, leconRefuseeParLeJuge, objectionsDuJuge } from './objections-juge'
import { attestJudgeApprovedLearning } from './orchestrator'

/*
 * UNE OBJECTION QUI NE PORTE QUE SUR LA LEÇON NE BLOQUE PAS LE LIVRABLE (conv-1149, 2026-10-25).
 *
 * Défaut vécu sur conv-1146 (run-ec2036c0932d-1) : cinq refus d'affilée du juge (réparations 11 à 15)
 * portaient sur la LEÇON proposée en fin de résultat (`AUTOWIN_LESSON_V1`) — « 4 messages » au lieu
 * de 5, « 8 caractères dont 3 lettres » au lieu de « 3 lettres à la suite » —, jamais sur la
 * traduction demandée. La consigne disait « refuse si son contenu n'est pas exactement soutenu » :
 * chaque détail de la leçon relançait build + nettoyage + juge (jusqu'à 12,60 $ le passage).
 *
 * Désormais : une réserve visible et non bloquante (« OK: leçon refusée — … »), et la leçon
 * refusée n'est PAS enregistrée — le refus de la leçon ne coûte plus une réparation, et une leçon
 * fausse n'entre pas pour autant au Brain. « MINEUR » ne convient pas : depuis conv-844, il bloque.
 */
const LECON =
  'AUTOWIN_LESSON_V1: {"outcome":"success","title":"Audit des textes","body":"Le seuil est de 8 caractères.","type":"lesson","scope":"project","tags":["langue"],"confidence":"medium"}'
const AGREGAT = `Traduction livrée, tests verts.\n${LECON}`
const VERDICT_LECON_REFUSEE = [
  'VALIDE',
  'SCORE: 88',
  'OBJECTIONS:',
  '- OK: les 148 tests passent (code 0)',
  '- OK: leçon refusée — le seuil cité (8 caractères) n’est pas celui qui déclenche l’alerte'
].join('\n')

describe('consigne du juge : la leçon proposée', () => {
  it('range une objection sur la seule leçon en réserve non bloquante, jamais en refus', () => {
    const juge = PHASE_BRIEFS.judge
    expect(juge).toContain('OK: leçon refusée')
    expect(juge).toMatch(/ne (?:refuse|bloque) JAMAIS le livrable/)
    // L'ancienne règle « refuse si son contenu n'est pas exactement soutenu » a disparu.
    expect(juge).not.toMatch(/refuse si son contenu/)
    expect(juge.length).toBeLessThan(3000)
  })
})

describe('lecture du verdict : « OK: leçon refusée » ne bloque pas', () => {
  it('ne compte pas comme une objection bloquante, et la clôture reste cochée', () => {
    expect(objectionsDuJuge(VERDICT_LECON_REFUSEE)).toEqual([])
    expect(dodDuVerdict(true, VERDICT_LECON_REFUSEE).every((c) => c.checked)).toBe(true)
  })

  it('est reconnue comme un refus de la leçon, et seulement elle', () => {
    expect(leconRefuseeParLeJuge(VERDICT_LECON_REFUSEE)).toBe(true)
    expect(leconRefuseeParLeJuge('VALIDE\nOBJECTIONS:\n- OK: Lecon refusee : chiffre faux')).toBe(
      true
    )
    expect(leconRefuseeParLeJuge('VALIDE\nOBJECTIONS:\n- OK: la leçon est exacte')).toBe(false)
    expect(leconRefuseeParLeJuge('VALIDE\nOBJECTIONS:\n- aucune')).toBe(false)
  })
})

describe('enregistrement : une leçon refusée par le juge n’est pas attestée', () => {
  it('livrable validé + leçon refusée → aucune attestation', () => {
    expect(
      attestJudgeApprovedLearning(
        AGREGAT,
        true,
        'run-1',
        'rec',
        'juge',
        'C:\\ws',
        VERDICT_LECON_REFUSEE
      )
    ).toEqual([])
  })

  it('témoin : livrable validé sans refus de la leçon → la leçon est attestée', () => {
    const verdict = 'VALIDE\nSCORE: 90\nOBJECTIONS:\n- aucune'
    expect(
      attestJudgeApprovedLearning(AGREGAT, true, 'run-1', 'rec', 'juge', 'C:\\ws', verdict)
    ).toHaveLength(1)
  })
})
