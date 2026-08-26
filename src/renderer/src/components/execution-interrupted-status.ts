/**
 * VUE GRAPHE — un nœud d'étape ne doit jamais rester « en cours » quand plus rien ne tourne.
 *
 * `persistOrchestrationPhaseStart` (main) écrit un événement de trace `status: 'running'` au
 * DÉMARRAGE d'une phase, et compte sur l'événement terminal pour dire la suite. L'app tuée en pleine
 * phase, ce terminal n'arrive jamais : le `running` reste sur disque, et le graphe le relit
 * indéfiniment comme une étape active. C'est le « je vois encore des choses en cours » de conv-1056.
 *
 * La réconciliation se fait ICI, à la lecture, parce que c'est le seul endroit qui connaît la
 * réponse : hors run vivant sur cette conversation, un `running`/`pending` persisté est par
 * construction abandonné. On ne réécrit RIEN sur disque (la trace reste un fait historique) — on
 * corrige ce qu'on AFFICHE.
 *
 * Le sens inverse est tout aussi important : tant qu'un run est vivant, ses étapes gardent
 * « en cours ». Une réconciliation trop zélée ferait passer un travail réel pour un travail mort.
 */

/** Statuts qui, hors run vivant, sont des restes d'un run interrompu. */
const STRANDED = new Set(['running', 'pending'])

/**
 * Libellé d'un statut d'étape. Vit ICI et non dans le composant : un `.tsx` qui exporte autre chose
 * que des composants casse le Fast Refresh (règle `react-refresh/only-export-components`), et cette
 * table est de toute façon la sémantique des statuts, pas du rendu.
 */
export function statusLabel(status: string | undefined): string {
  if (status === 'running') return 'en cours'
  if (status === 'failed') return 'échec'
  if (status === 'cancelled') return 'annulé'
  if (status === 'pending') return 'en attente'
  // Une étape que l'app a laissée en route n'est PAS terminée : sans cette branche elle tombait dans
  // le défaut « terminé », et le graphe annonçait une réussite qui n'a jamais eu lieu.
  if (status === 'interrupted') return 'interrompu'
  return 'terminé'
}

export function settleStrandedExecutionStatus<T extends { status?: string }>(
  events: readonly T[],
  options: { live: boolean }
): T[] {
  // Un run en vol a le droit d'afficher « en cours » : c'est la vérité.
  if (options.live) return events as T[]
  let changed = false
  const settled = events.map((event) => {
    if (!event.status || !STRANDED.has(event.status)) return event
    changed = true
    return { ...event, status: 'interrupted' }
  })
  // Même référence quand rien ne bouge : le résultat alimente un `useMemo` de rendu.
  return changed ? settled : (events as T[])
}
