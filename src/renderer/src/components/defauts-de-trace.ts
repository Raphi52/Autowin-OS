import type { CausalPathIssue, CausalPathNode } from './causal-path-model'

/**
 * LES SEULS SIGNALEMENTS QUI SONT DES DÉFAUTS — ceux que la fiche d'une étape écrit en orange.
 *
 * « quand je clique sur un node ya plein de nodes qui ont une erreur, surtout pendant les
 * orchestrations » (2026-10-13). Mesuré sur 789 briques de 25 conversations : 395 portaient une
 * ligne orange, et aucune n'était un défaut de trace. `buildCausalPath` signale toute brique sans
 * durée (`missing-duration`) et toute brique dont un enfant n'en a pas (`incomplete-child-timing`).
 * Or une étape EN COURS n'a pas encore de durée, et « Réponse affichée » est instantanée : ce sont
 * des états normaux, pas une trace abîmée.
 *
 * Restent des défauts : un parent introuvable, une boucle causale, et une durée absente là où la
 * trace DEVAIT en écrire une — un agent ou un outil qui a fini. Le modèle causal garde tous ses
 * signalements (le chemin critique en a besoin) : seul l'AFFICHAGE est trié ici.
 */
const PAS_ENCORE_FINI = new Set(['running', 'pending', 'interrupted'])

/** Une étape dont la trace DOIT porter une durée : un agent ou un outil qui a fini. */
function doitAvoirUneDuree(node: CausalPathNode): boolean {
  const kind = node.event.display?.kind
  if (kind !== 'agent' && kind !== 'tool') return false
  return !PAS_ENCORE_FINI.has(node.event.status ?? 'completed')
}

export function defautsDeTrace(node: CausalPathNode): CausalPathIssue[] {
  return node.issues.filter((issue) => {
    if (issue === 'missing-duration') return doitAvoirUneDuree(node)
    if (issue === 'incomplete-child-timing')
      return node.children.some(
        (enfant) => enfant.inclusiveDurationMs == null && doitAvoirUneDuree(enfant)
      )
    return true
  })
}
