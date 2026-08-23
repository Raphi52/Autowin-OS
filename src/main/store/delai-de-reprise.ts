/**
 * COMBIEN DE TEMPS ATTENDRE avant de réessayer d'intégrer un travail refusé.
 *
 * Mesuré le 2026-08-23 : la fenêtre de rattrapage faisait TRENTE SECONDES — six essais espacés de
 * cinq secondes — après quoi le travail passait `abandoned: true`, hors de portée de toute reprise
 * automatique. Sur les traces : 458 refus `base-in-progress`, la deuxième cause.
 *
 * Le code du gestionnaire de copies le disait déjà, sans que personne n'en tire la conséquence :
 * « 216 refus base-in-progress contre 86 base-dirty, parce que l'utilisateur travaille en continu
 * dans la base — ce refus est la NORME, pas l'exception ». Un arbre partagé se libère en minutes ;
 * on lui accordait une demi-minute.
 *
 * DEUX EXIGENCES CONTRADICTOIRES, tenues ensemble :
 *   1. patienter beaucoup plus longtemps — sinon on abandonne du travail fini pour une occupation
 *      passagère ;
 *   2. s'arrêter pour de bon — une minuterie qui ne se tait jamais est un défaut pire que l'abandon.
 *
 * D'où un backoff CROISSANT et BORNÉ, plutôt qu'un délai fixe : un délai fixe est mauvais aux deux
 * bouts — trop long pour une occupation d'une seconde, trop court sur une heure de travail humain.
 * Le premier essai reste donc à cinq secondes, et le dernier à trente minutes.
 */

/** Les attentes successives, en millisecondes. Total : un peu plus de 51 minutes. */
export const DELAIS_REPRISE = [
  5_000, // l'occupation la plus courante : un enregistrement, une commande git
  15_000,
  45_000,
  120_000,
  300_000,
  900_000,
  1_800_000 // plafond : au-delà, ce n'est plus une occupation passagère
] as const

/** Au-delà, le travail est abandonné — et c'est voulu : voir l'exigence n°2. */
export const ESSAIS_MAX = DELAIS_REPRISE.length

/**
 * L'attente avant le prochain essai, ou `null` quand il n'y a plus rien à tenter.
 *
 * `null` est un VERDICT, pas une absence de réponse : il dit « arrête », et c'est ce qui rend
 * l'arrêt testable.
 */
export function delaiDeReprise(essaisDejaFaits: number): number | null {
  // Une entrée aberrante ne doit ni jeter ni produire une attente négative : on retombe sur le
  // premier délai, le plus court, donc le moins risqué.
  if (!Number.isFinite(essaisDejaFaits) || essaisDejaFaits < 0) return DELAIS_REPRISE[0]
  if (essaisDejaFaits >= ESSAIS_MAX) return null
  return DELAIS_REPRISE[Math.floor(essaisDejaFaits)]
}
