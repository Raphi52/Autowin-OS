/**
 * POURQUOI UN TOUR S'EST ARRÊTÉ — et comment le DIRE.
 *
 * Mesuré sur conv-136 le 2026-09-02. Un tour lance une orchestration de 25 min ; le veilleur
 * d'inactivité (`run-pilot-chat.ts`) la croit morte à 20 min et coupe avec un motif soigneusement
 * rédigé (« aucun signe de vie depuis 20 minutes… »). Ce motif n'atteignait JAMAIS l'utilisateur :
 * le `catch` ne requalifiait que la coupure BUDGET, donc tout autre abort devenait `cancelled` —
 * un stop volontaire que personne n'avait demandé — et le texte du tour retombait sur les
 * étiquettes d'action nues. Le fil affichait « [a exécuté orchestrate] », rien d'autre : ni
 * réponse, ni erreur, ni moyen de savoir que c'était mort. Le run, lui, avait fini VERT 5 min plus
 * tard, et son compte-rendu est tombé dans le vide.
 *
 * D'où deux choses ici, et une seule idée : un arrêt qui porte une CAUSE n'est pas une annulation.
 * Le préfixe est la seule façon de relier l'abort à son motif (`signal.reason` est le seul canal),
 * et `terminalDuTour` est la décision elle-même — pure, donc réellement testable, au lieu d'une
 * suite de ternaires enfouie dans un `catch` que seul un test de source peut effleurer.
 */

/** Préfixe du motif posé par le veilleur d'inactivité — la seule façon de le requalifier ensuite. */
export const CHAT_INACTIVITE_ABORT_PREFIX = 'Tour interrompu : aucun signe de vie'

/**
 * Le motif LU par l'utilisateur quand le veilleur coupe. Il nomme la durée (sans elle, impossible
 * de décider si c'était long ou mort) et dit ce qui a pu arriver au travail lancé.
 */
export function motifInactivite(plafondMs: number): string {
  return (
    `${CHAT_INACTIVITE_ABORT_PREFIX} depuis ${Math.round(plafondMs / 60000)} minutes. ` +
    'Le travail lancé a pu se terminer sans rendre son résultat — relance ta demande.'
  )
}

/** Une coupure du veilleur n'est PAS un stop volontaire : elle doit finir `failed` avec sa cause. */
export function estCoupureVeilleur(reason: unknown): boolean {
  return typeof reason === 'string' && reason.startsWith(CHAT_INACTIVITE_ABORT_PREFIX)
}

export type TerminalDuTour =
  { readonly kind: 'failed'; readonly error: string } | { readonly kind: 'cancelled' }

/**
 * L'état terminal d'un tour interrompu.
 *
 * `cancelled` est réservé à ce que l'utilisateur a VOULU (bouton stop → `reason` = `'user'`, ou
 * suppression de la conversation). Tout abort qui porte une cause machine — budget dépassé,
 * veilleur d'inactivité — est un ÉCHEC et voyage AVEC son motif : c'est ce que l'utilisateur doit
 * lire à la place d'une bulle muette.
 */
export function terminalDuTour(arret: {
  aborted: boolean
  reason: unknown
  /** L'erreur levée quand ce n'est pas un abort. */
  erreur?: unknown
  /** Requalification déjà connue de l'appelant (coupure budget). */
  motivee?: boolean
}): TerminalDuTour {
  const motive = arret.aborted && (arret.motivee === true || estCoupureVeilleur(arret.reason))
  if (motive) return { kind: 'failed', error: String(arret.reason) }
  if (arret.aborted) return { kind: 'cancelled' }
  return {
    kind: 'failed',
    error: arret.erreur instanceof Error ? arret.erreur.message : String(arret.erreur)
  }
}
