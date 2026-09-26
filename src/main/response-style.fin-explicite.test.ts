import { describe, expect, it } from 'vitest'
import { STYLE_CLOTURE_CHAT } from './response-style'
import { signalFinExplicite } from '../shared/prompt-suivant'

describe('consigne de clôture — fin explicite du mode auto', () => {
  it('demande la ligne AUTOWIN_FIN_V1 que le mode auto sait lire', () => {
    expect(STYLE_CLOTURE_CHAT).toContain('`AUTOWIN_FIN_V1`')
    // La forme décrite par la consigne est bien celle que le code reconnaît.
    expect(signalFinExplicite('👉 Recommandé — aucune suite : le travail est livré\nAUTOWIN_FIN_V1')).toBe(true)
  })
  it("ne présente plus le mot « rien » comme l'interrupteur", () => {
    expect(STYLE_CLOTURE_CHAT).not.toMatch(/« rien », mais aussi/)
  })
})
