import type { ScopedLiveRun } from './chat-view-model'

/**
 * SÉLECTION DES FILS DE SOUS-AGENTS.
 *
 * Le nom du fichier parle encore des « sections » d'origine (Sous-agents / Run / Graphe / Source
 * control) : celles-là n'existent plus. Le panneau porte depuis le 2026-09-01 trois onglets d'une
 * autre nature — Graph, Runs, Logs — et, DANS l'onglet Graph, c'est toujours le graphe qui sert de
 * navigation : le détail affiché découle du nœud sélectionné. Ne subsiste ici que la règle de
 * portée des fils, qui, elle, sert toujours.
 */

/**
 * Les fils de sous-agents à afficher : ceux de la conversation active, ou tous sur demande.
 *
 * Ne filtre RIEN sur le statut — un run TERMINÉ garde sa place. C'est le défaut d'origine : le fil
 * disparaissait dès que le run passait au vert, alors que c'est fini qu'on veut le relire.
 */
export function visibleScopedRuns<TStep>(
  liveRuns: Record<string, ScopedLiveRun<TStep>>,
  activeId: string | undefined,
  scope: 'conv' | 'tous'
): Array<[string, ScopedLiveRun<TStep>]> {
  if (scope === 'tous') return Object.entries(liveRuns)
  const active = activeId ? liveRuns[activeId] : undefined
  return activeId && active ? [[activeId, active]] : []
}
