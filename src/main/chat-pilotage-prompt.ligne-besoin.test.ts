import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt, CONSIGNE_LIGNE_BESOIN } from './chat-pilotage-prompt'
import { lireLigneBesoin } from '../shared/ligne-besoin'

describe('consigne de la ligne de besoin (carte des besoins, lot 2)', () => {
  const lecture = [
    { name: 'get_state', args: {}, description: 'lire', annotations: { readOnlyHint: true } }
  ]
  const action = [{ name: 'orchestrate', args: {}, description: 'agir' }]

  it('est servie au chat, tour de lecture compris', () => {
    expect(buildChatPilotagePrompt(action)).toContain(CONSIGNE_LIGNE_BESOIN)
    expect(buildChatPilotagePrompt(lecture)).toContain(CONSIGNE_LIGNE_BESOIN)
  })

  it('chaque valeur que la consigne enseigne est une valeur que le code sait lire', () => {
    const valeurs = [
      ...CONSIGNE_LIGNE_BESOIN.matchAll(/`(nouveau|suite(?: conv-NNN)?|aucun)`/gu)
    ].map((m) => m[1].replace('NNN', '42'))
    expect(valeurs).toEqual(['nouveau', 'suite', 'suite conv-42', 'aucun'])
    for (const valeur of valeurs)
      expect(lireLigneBesoin(`AUTOWIN_BESOIN_V1: ${valeur}`), valeur).not.toBeNull()
  })

  it('laisse les lignes de suite et de fin en dernier', () => {
    expect(CONSIGNE_LIGNE_BESOIN).toMatch(
      /AVANT les lignes `AUTOWIN_PROMPT_V1` ou `AUTOWIN_FIN_V1`/u
    )
  })
})
