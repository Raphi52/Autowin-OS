/**
 * LES LIBELLÉS DE CLÔTURE SONT ÉCRITS POUR L'UTILISATEUR.
 *
 * Suite du 20/08 : après les motifs de refus (`gates/stopgate.messages.test.ts`), leur ENCADREMENT.
 * Le fil affichait « ⛔ Workflow BLOQUÉ par le gate — livrable non validé · statut failed » : trois
 * termes de mécanique — « gate » (le contrôle de clôture), « livrable » (ce qui a été produit) et un
 * statut resté en anglais brut. Déplier un motif lisible dans un cadre en jargon ne règle rien.
 */
import { describe, expect, it } from 'vitest'
import { formatOrchestrationOutcome } from './orchestration-outcome'

const JARGON = ['gate', 'livrable', 'failed', 'green', 'red', 'blocked']

const sansJargon = (texte: string): void => {
  for (const mot of JARGON) expect(texte.toLowerCase()).not.toContain(mot)
}

describe('formatOrchestrationOutcome — sans vocabulaire de mécanique', () => {
  it('un arrêt au contrôle final le dit en français, statut traduit', () => {
    const texte = formatOrchestrationOutcome(true, { gateBlocked: true, status: 'failed' })
    sansJargon(texte)
    expect(texte).toContain('contrôle final')
    expect(texte).toContain('échoué')
  })

  it('un refus du juge parle du RÉSULTAT, pas du « livrable »', () => {
    const texte = formatOrchestrationOutcome(true, { valid: false, status: 'failed' })
    sansJargon(texte)
    expect(texte).toContain('résultat')
  })

  it('un succès traduit aussi son statut', () => {
    const texte = formatOrchestrationOutcome(true, {
      status: 'green',
      valid: true,
      delivered: true
    })
    sansJargon(texte)
    expect(texte).toContain('réussi')
  })

  it('un statut inconnu est rendu TEL QUEL — on ne traduit pas ce qu’on ne connaît pas', () => {
    const texte = formatOrchestrationOutcome(true, { valid: false, status: 'quelque-chose' })
    expect(texte).toContain('quelque-chose')
  })
})
