/**
 * « Reprendre en PRÉCISANT » — le chaînon manquant des reprises.
 *
 * `↻ Renvoyer` / `↻ Reprendre` rejouent un tour à l'identique : si le tour a échoué faute de
 * précision, le rejeu échoue pareil. Ce module fabrique le BROUILLON d'une reprise informée :
 * prompt d'origine + motif d'échec constaté + une invite à préciser. Rien n'est envoyé : c'est
 * l'utilisateur qui complète puis valide.
 *
 * PUR → testable directement.
 */

export type TerminalStatus = 'cancelled' | 'interrupted' | 'failed'

const MOTIF: Record<TerminalStatus, string> = {
  cancelled: 'le tour précédent a été annulé',
  interrupted: 'le tour précédent a été interrompu avant la fin',
  failed: 'le tour précédent a échoué'
}

/** Libellé du motif affiché/inséré, enrichi de l'erreur remontée quand il y en a une. */
export function failureMotif(status: TerminalStatus, reason?: string | null): string {
  const detail = reason?.replace(/\s+/g, ' ').trim()
  return detail ? `${MOTIF[status]} : ${detail}` : MOTIF[status]
}

/**
 * Brouillon pré-rempli. Idempotent : appliqué deux fois sur le même prompt, il n'empile pas
 * deux blocs de motif (le bouton peut être recliqué).
 */
export function buildRefineDraft(
  prompt: string,
  status: TerminalStatus,
  reason?: string | null
): string {
  const base = prompt.trim()
  const motif = failureMotif(status, reason)
  const bloc = `[reprise] ${motif}. Précise ci-dessous ce qui doit changer :`
  if (base.includes('[reprise] ')) return base
  return `${base}\n\n${bloc}\n`
}
