import type { ScopedLiveRun } from './chat-view-model'

/**
 * SÉLECTION DES FILS DE SOUS-AGENTS.
 *
 * Le nom du fichier parle encore de « sections » : elles n'existent plus. Le panneau n'a plus
 * d'onglets — le graphe d'exécution est sa navigation, et le détail affiché découle du nœud
 * sélectionné. Ne subsiste ici que la règle de portée des fils, qui, elle, sert toujours.
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
