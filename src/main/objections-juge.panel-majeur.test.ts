import { describe, expect, it } from 'vitest'
import { dodDuVerdict, verdictPanelValide } from './objections-juge'

/**
 * conv-540, tour 8bc214db-8c48-4a29-880d-1ef4c4391d1f : les 4 appels du juge (promptCalls ts
 * 09:44:57.329, 09:48:05.122, 09:51:14.024, 09:53:28.437) rendent VALIDE 72-74, et le controle de
 * 09:53:28.450 recopie 6 puces en « Promis mais pas fait » — dont des VERIFICATIONS REUSSIES
 * (« les 11 commits existent bien… 240 sur 240, code de sortie 0 »). Cause : dans un verdict
 * agrege de panel, les puces du dissident sont etiquetees MAJEUR tandis que celles des membres
 * APPROBATEURS restent nues ; la regle « non etiquete = majeur » les retenait toutes.
 */
describe('verdict agrege : les constats des membres approbateurs ne sont pas des promesses', () => {
  const agrege = verdictPanelValide([
    { text: 'VALIDE\n\nOBJECTIONS:\n- les 11 commits existent bien, 240 sur 240, code de sortie 0\n', ok: true },
    { text: 'VALIDE\n\nOBJECTIONS:\n- les 7 tests passent maintenant\n', ok: true },
    { text: 'DEFAUT: le tour n’est pas fini en reussite\n\nOBJECTIONS:\n- aucun tour de l’app rejoue au vert\n', ok: false }
  ])

  it('le dissident est bien etiquete MAJEUR', () => {
    expect(agrege).toContain('MAJEUR: aucun tour de l’app rejoue au vert')
  })

  it('le controle ne recopie QUE la puce MAJEUR', () => {
    const cases = dodDuVerdict(false, agrege)
    const libelles = cases.map((c) => c.label ?? '').join('\n')
    expect(libelles).toContain('aucun tour de l’app rejoue au vert')
    expect(libelles).not.toContain('240 sur 240')
    expect(libelles).not.toContain('les 7 tests passent maintenant')
    expect(cases).toHaveLength(1)
  })
})
