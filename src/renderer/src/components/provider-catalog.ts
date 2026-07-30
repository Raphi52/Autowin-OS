export interface ProviderCatalogEntry {
  provider: string
}

/**
 * Projection unique de la liste affichée par Agent Studio.
 * Les modèles importés et les statuts runtime sont les deux sources autorisées.
 */
export function agentStudioProviderIds(
  models: readonly ProviderCatalogEntry[],
  statuses: readonly ProviderCatalogEntry[]
): string[] {
  return [
    ...new Set([...models, ...statuses].map(({ provider }) => provider.trim()).filter(Boolean))
  ].sort((left, right) => left.localeCompare(right))
}
