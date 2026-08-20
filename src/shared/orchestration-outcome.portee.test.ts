import { describe, expect, it } from 'vitest'
import {
  formatOrchestrationOutcome,
  hasAuthoritativeDeliveredClosingBlock,
  phasesJouees
} from './orchestration-outcome'

/**
 * LA CLOTURE NE DOIT PLUS MENTIR SUR LA PORTEE.
 *
 * Rejoue la conversation du 20/08. L'utilisateur lance `/frame` en ecrivant « Ce tour ne joue que la
 * phase frame : la suite (terrain → build → clean → judge) s'enchaine au tour suivant ». Il recoit
 * « ⏳ Reste a faire : rien. 👉 Recommande : passer a la prochaine demande. » et repond au tour
 * suivant : « la vache t'as deja tout fait ? ». Le bloc venait d'Autowin, pas du modele.
 */
const livre = (phases: string[]): Parameters<typeof formatOrchestrationOutcome>[1] => ({
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  result: 'Le cadrage du besoin.',
  phaseOutputs: phases.map((phase) => ({ phase, text: `livrable ${phase}` }))
})

describe('clôture d’un run d’ANALYSE seule', () => {
  it('un /frame livré n’annonce PLUS « reste à faire : rien »', () => {
    const texte = formatOrchestrationOutcome(true, livre(['frame']))
    expect(texte).not.toContain('Reste à faire : rien')
    expect(texte).not.toContain('passer à la prochaine demande')
  })

  it('il nomme la phase jouée et ce qui reste de la chaîne', () => {
    const texte = formatOrchestrationOutcome(true, livre(['frame']))
    expect(texte).toContain('Reste à faire : terrain → build → clean → judge.')
    expect(texte).toContain('Recommandé : lancer terrain.')
    expect(texte).toContain('phase frame')
  })

  it('il dit explicitement que le besoin N’EST PAS réalisé', () => {
    const texte = formatOrchestrationOutcome(true, livre(['scout', 'frame']))
    expect(texte).toMatch(/besoin lui-m[êe]me n.est PAS r[ée]alis[ée]/u)
    expect(texte).toContain("rien n'a été muté")
  })
})

describe('clôture d’un run qui a MUTÉ — comportement d’origine, intact', () => {
  it('un run avec build garde « reste à faire : rien »', () => {
    // La garantie qui compte : borner le mensonge ne doit pas retirer la clôture legitime.
    const texte = formatOrchestrationOutcome(true, livre(['frame', 'build', 'judge']))
    expect(texte).toContain('Reste à faire : rien.')
    expect(texte).toContain('passer à la prochaine demande')
  })

  it('sans phase connue, on ne devine pas : clôture d’origine', () => {
    const texte = formatOrchestrationOutcome(true, livre([]))
    expect(texte).toContain('Reste à faire : rien.')
  })
})

describe('phasesJouees', () => {
  it('lit les phases de l’issue, et ignore ce qui n’en est pas', () => {
    expect(phasesJouees(livre(['frame', 'build']))).toEqual(['frame', 'build'])
    expect(phasesJouees({ phaseOutputs: [{ phase: 42 }, { phase: '  ' }, null] })).toEqual([])
    expect(phasesJouees({})).toEqual([])
    expect(phasesJouees(undefined)).toEqual([])
  })
})

describe('le bloc honnête est RELU comme celui d’Autowin', () => {
  /*
   * Regression que le correctif du gabarit portait sans le dire : le reconnaisseur ne connaissait
   * que l'ancienne forme. Non reconnu, le bloc etait RETIRE au rechargement par
   * `reconcileClosedOrchestrationText` — la cloture corrigee disparaissait de la conversation. Un
   * bloc qu'on ecrit doit aussi pouvoir etre relu.
   */
  it('reconnaît la forme d’analyse seule', () => {
    const texte = formatOrchestrationOutcome(true, livre(['frame']))
    expect(hasAuthoritativeDeliveredClosingBlock(texte)).toBe(true)
  })

  it('reconnaît toujours la forme d’origine', () => {
    const texte = formatOrchestrationOutcome(true, livre(['frame', 'build']))
    expect(hasAuthoritativeDeliveredClosingBlock(texte)).toBe(true)
  })

  it('ne prend PAS un bloc libre du worker pour celui d’Autowin', () => {
    const libre = [
      '✅ Fait',
      '1. J’ai lu trois fichiers.',
      '📍 Maintenant : je continue.',
      '⏳ Reste à faire : le reste.',
      '👉 Recommandé : avancer.'
    ].join('\n')
    expect(hasAuthoritativeDeliveredClosingBlock(libre)).toBe(false)
  })
})
