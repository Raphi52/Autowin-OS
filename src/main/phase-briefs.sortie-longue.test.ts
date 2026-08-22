import { describe, expect, it } from 'vitest'
import { PHASE_BRIEFS } from './phase-briefs'

/**
 * UNE COMMANDE LONGUE NE DOIT PAS SE RELANCER POUR ETRE LUE.
 *
 * Vecu le 2026-08-22, rapporte par l'utilisateur en ces termes : « cette etape dure 1000 ans ».
 * Le sous-agent BUILD avait lance la suite complete (~15 min), sa sortie a ete tronquee avant le
 * resume, et il a RELANCE — quatre fois d'apres son propre texte : « Output was truncated
 * mid-stream », « Rerunning with a compact reporter », « truncated before the summary », « One more
 * pass to capture it ». Une heure pour un chiffre qu'un fichier rendait en une lecture.
 *
 * Rien dans le brief ne lui disait la conduite a tenir. Il improvisait donc la pire : re-executer.
 */
describe('brief BUILD — conduite devant une sortie longue', () => {
  it('dit de rediriger vers un fichier puis de LIRE, au lieu de relancer', () => {
    expect(PHASE_BRIEFS.build).toMatch(/redirige/i)
    expect(PHASE_BRIEFS.build).toMatch(/tronqu/i)
  })

  it('interdit explicitement la relance pour capturer une sortie', () => {
    expect(PHASE_BRIEFS.build).toMatch(/ne RELANCE (?:jamais|pas)/i)
  })

  it('n a pas perdu ses gardes existantes', () => {
    // Le brief est ecrit en concurrence par une autre session : cette assertion detecte une
    // ecrasure accidentelle de son travail par le mien.
    expect(PHASE_BRIEFS.build).toContain('ANTI-BLOCAGE')
    expect(PHASE_BRIEFS.build).toContain('AUTOWIN_PARI_V1')
    expect(PHASE_BRIEFS.build).toContain('AUTOWIN_LESSON_V1')
    expect(PHASE_BRIEFS.build).toMatch(/reproduis le rouge AVANT/)
  })
})
