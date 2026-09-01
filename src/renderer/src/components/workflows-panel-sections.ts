import type { ScopedLiveRun } from './chat-view-model'

/**
 * SÉLECTION DES FILS DE SOUS-AGENTS.
 *
 * Ce module portait aussi le modèle des QUATRE sections du panneau (`WORKFLOW_PANEL_SECTIONS`,
 * `sectionUsesScope`). Ces sections ont disparu : le graphe d’exécution est devenu la navigation
 * du panneau, et le détail affiché découle du nœud sélectionné. Le modèle a donc été retiré plutôt
 * que laissé en place sans consommateur — un export mort finit toujours par être recâblé par erreur.
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
