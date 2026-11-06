import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'

/**
 * LA REGLE 4 BIS DE /build DOIT ARRIVER DANS LES RUNS AUTOMATIQUES.
 *
 * Le corps de skills/build/SKILL.md n'est injecte que si l'utilisateur tape /build (commands.ts).
 * Un run automatique ne voit que PHASE_BRIEFS.build. Or la regle 4 bis (jumeau d'acceptation) est
 * la seule de la skill mesuree : 35/35 sur le banc arenagame avec elle, cas caches perdus sans
 * (refus trop large `<=` au lieu de `<`, refus invente « achat unique »).
 */
describe('brief BUILD — jumeau d acceptation (regle 4 bis)', () => {
  const brief = PHASE_BRIEFS.build

  it('demande un jumeau d acceptation a chaque refus', () => {
    expect(brief).toMatch(/jumeau/i)
    expect(brief).toMatch(/accept/i)
  })

  it('interdit les refus que le contrat n implique pas', () => {
    expect(brief).toMatch(/refus[^.]*contrat/i)
  })

  it('n a pas perdu ses gardes existantes', () => {
    expect(brief).toContain('reproduis le rouge')
    expect(brief).toContain('ANTI-BLOCAGE')
    expect(brief).toContain('AUTOWIN_PARI_V1')
    expect(brief).toContain('AUTOWIN_LESSON_V1')
  })
})
