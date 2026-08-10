/**
 * Ce qui empêche un workflow de tourner — et qui joue réellement quel rôle.
 *
 * Un workflow pouvait être ACTIVÉ alors qu'il était structurellement mort : une phase que rien ne
 * sait jouer, un nœud sans agent, une arête pointant un nœud supprimé (la portée l'ignorait en
 * silence, `return null`). Ces fonctions sont PURES et vivent hors du composant : c'est ce qui
 * permet de les tester seules et de décider de l'activation avant tout appel IPC.
 */

export interface ExecutabilityInput {
  id: string
  name: string
  roles?: Record<string, { provider?: string; model?: string; reasoningEffort?: string }>
  phases?: string[]
  graph?: import('./WorkflowCanvas').CanvasGraph
}

/** Les phases qu'un run sait réellement jouer (miroir de `ORCHESTRATE_PHASES`, côté main). */
const PHASES_CONNUES: ReadonlySet<string> = new Set([
  'scout',
  'frame',
  'terrain',
  'build',
  'clean',
  'judge',
  'kaizen'
])

/** Les nœuds d'un profil, que sa topologie vienne du graphe composé ou de ses seules phases. */
export function trackNodes(
  profile: ExecutabilityInput
): { id: string; phase: string; agents: number }[] {
  if (profile.graph?.nodes?.length) {
    return profile.graph.nodes.map((n) => ({
      id: n.id,
      phase: n.phase,
      agents: n.agents?.length ?? 1
    }))
  }
  const vus = new Map<string, number>()
  return (profile.phases ?? []).map((phase) => {
    const rang = (vus.get(phase) ?? 0) + 1
    vus.set(phase, rang)
    return { id: `${phase}-${rang}`, phase, agents: 1 }
  })
}

/** Tout ce qui rend un workflow inexécutable, en clair. Liste vide = activable. */
export function workflowIssues(profile: ExecutabilityInput): string[] {
  const issues: string[] = []
  const nodes = trackNodes(profile)
  if (!nodes.length) return ['aucune phase : ce workflow ne jouerait rien']
  for (const node of nodes) {
    if (!PHASES_CONNUES.has(node.phase)) issues.push(`phase inconnue : ${node.phase}`)
    if (node.agents < 1) issues.push(`aucun agent sur le nœud ${node.id}`)
  }
  const connus = new Set(nodes.map((node) => node.id))
  for (const edge of profile.graph?.edges ?? []) {
    if (!connus.has(edge.from)) {
      issues.push(`arête orpheline : ${edge.from} → ${edge.to} (source inconnue)`)
    } else if (!connus.has(edge.to)) {
      issues.push(`arête orpheline : ${edge.from} → ${edge.to} (cible inconnue)`)
    }
  }
  return issues
}

/**
 * Quel modèle joue réellement chaque rôle. `AgentTopology.panels/subagents` et
 * `WorkflowProfile.roles` étaient deux sources de vérité silencieuses : le workflow actif écrase la
 * topologie rôle par rôle sans que rien ne le montre. La dérivation devient explicite.
 */
export function rolesEffectifs(
  profile: ExecutabilityInput
): { role: string; modele: string; origine: 'workflow' | 'topologie' }[] {
  return Object.entries(profile.roles ?? {}).map(([role, binding]) => ({
    role,
    modele: binding?.model ?? '—',
    origine: binding?.model ? ('workflow' as const) : ('topologie' as const)
  }))
}
