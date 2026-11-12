/**
 * Bornes de la colonne de droite (fiche ou thème ouvert) : la seule colonne redimensionnable de la
 * vue Knowledge, dont les thèmes sont des pastilles au-dessus du graphe.
 */
export const GRAPH_COLUMN_LIMITS = {
  detail: { min: 160, max: 2400 },
  /** Largeur que le graphe garde toujours à gauche de la colonne. */
  detailGraph: 96
} as const

export function fitDetailColumnWidth(
  width: number,
  contentWidth: number,
  reservedLeftWidth = 0
): number {
  return Math.round(
    Math.min(
      GRAPH_COLUMN_LIMITS.detail.max,
      Math.max(
        GRAPH_COLUMN_LIMITS.detail.min,
        Math.min(width, contentWidth - reservedLeftWidth - GRAPH_COLUMN_LIMITS.detailGraph)
      )
    )
  )
}
