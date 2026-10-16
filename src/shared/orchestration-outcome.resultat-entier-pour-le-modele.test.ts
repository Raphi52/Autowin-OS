import { describe, expect, it } from 'vitest'
import {
  CARACTERES_MAX_RESULTAT_AFFICHE,
  formatOrchestrationOutcome,
  formatOrchestrationOutcomePourLeModele
} from './orchestration-outcome'

/**
 * Deux lecteurs, un seul compte-rendu (conv-914) : la bulle est bornée, le modèle lit tout.
 * Le test de bout en bout est `src/main/agent-pilot.resultat-entier-au-modele.test.ts`.
 */
const long = `debut ${'x'.repeat(CARACTERES_MAX_RESULTAT_AFFICHE + 2_000)} FIN-DU-RESULTAT`
const issue = {
  status: 'succeeded',
  valid: true,
  gateBlocked: false,
  reused: false,
  runPath: 'C:/runs/conv/pistes-workspace/RUN.md',
  result: long
}

describe('formatOrchestrationOutcomePourLeModele — le résultat n’est pas coupé', () => {
  it('rend le résultat ENTIER, sans avis de troncature', () => {
    const texte = formatOrchestrationOutcomePourLeModele(true, issue)
    expect(texte).toContain('FIN-DU-RESULTAT')
    expect(texte).not.toContain('[tronqué')
  })

  it('l’affichage, lui, reste borné et dit où lire la suite', () => {
    const texte = formatOrchestrationOutcome(true, issue)
    expect(texte).not.toContain('FIN-DU-RESULTAT')
    expect(texte).toContain('[tronqué')
    expect(texte).toContain('« pistes »')
  })

  it('hors résultat, les deux comptes-rendus disent la même chose', () => {
    const court = { ...issue, result: 'trois pistes trouvées' }
    expect(formatOrchestrationOutcomePourLeModele(true, court, undefined, 'avis')).toBe(
      formatOrchestrationOutcome(true, court, undefined, 'avis')
    )
    expect(formatOrchestrationOutcomePourLeModele(false, undefined, 'budget dépassé')).toBe(
      formatOrchestrationOutcome(false, undefined, 'budget dépassé')
    )
  })
})
