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

import { langueCourante } from '../langue'
import { traduireChatFilsEtLots, type CleChatFilsEtLots } from '../textes-ecrans/chat-fils-et-lots'

export type TerminalStatus = 'cancelled' | 'interrupted' | 'failed'

/*
 * Le brouillon est le message de l'UTILISATEUR, qu'il complète : il suit la langue de l'écran
 * (traduction anglaise, conv-1170). Seul le repère `[reprise] ` reste en français : il est relu
 * (`includes`) pour ne pas empiler deux blocs, quelle que soit la langue au moment du clic.
 */
const MARQUEUR_REPRISE = '[reprise] '

const MOTIF: Record<TerminalStatus, CleChatFilsEtLots> = {
  cancelled: 'reprise.motif.cancelled',
  interrupted: 'reprise.motif.interrupted',
  failed: 'reprise.motif.failed'
}

/** Libellé du motif affiché/inséré, enrichi de l'erreur remontée quand il y en a une. */
export function failureMotif(status: TerminalStatus, reason?: string | null): string {
  const langue = langueCourante()
  const motif = traduireChatFilsEtLots(MOTIF[status], langue)
  const detail = reason?.replace(/\s+/g, ' ').trim()
  return detail ? traduireChatFilsEtLots('reprise.motifDetail', langue, { motif, detail }) : motif
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
  const bloc = `${MARQUEUR_REPRISE}${traduireChatFilsEtLots('reprise.invite', langueCourante(), { motif })}`
  if (base.includes(MARQUEUR_REPRISE)) return base
  return `${base}\n\n${bloc}\n`
}
