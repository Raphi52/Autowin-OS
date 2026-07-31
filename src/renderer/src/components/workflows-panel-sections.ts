import type { ScopedLiveRun } from './chat-view-model'

/**
 * LES TROIS SECTIONS DU PANNEAU WORKFLOWS.
 *
 * Le panneau n'en avait que deux — « Runs » et « Source control » — et la première MÉLANGEAIT deux choses
 * de natures différentes : le fil des sous-agents d'une orchestration, et la liste des RUN.md. Le fil se
 * retrouvait en encart au-dessus d'une liste, donc jamais consultable pour lui-même, alors qu'il est la
 * preuve de ce qui a été fait.
 *
 * Le modèle vit ici, hors du composant, pour que les libellés et la sélection soient VÉRIFIABLES sur leur
 * sortie plutôt que grepés dans du JSX.
 */
export const WORKFLOW_PANEL_SECTIONS = [
  { id: 'subagents', label: 'Sous-agents' },
  { id: 'run', label: 'Run' },
  { id: 'graph', label: 'Graphe' },
  { id: 'source-control', label: 'Source control' }
] as const

export type WorkflowPanelSection = (typeof WORKFLOW_PANEL_SECTIONS)[number]['id']

/** Sections gouvernées par la portée (« cette conversation » / « tous »). Pas Source control. */
export function sectionUsesScope(section: WorkflowPanelSection): boolean {
  return section === 'subagents' || section === 'run'
}

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
