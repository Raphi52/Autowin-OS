export interface ModelCatalogRefresherOptions<T> {
  freshnessMs?: number
  now?: () => number
  reconcile?: (current: T[], discovered: T[]) => T[]
  onApply?: (catalog: T[]) => void
}

/**
 * Maintient un catalogue rafraîchissable sans multiplier les probes fournisseurs.
 * Un échec ou une réponse vide conserve toujours le dernier catalogue utilisable.
 */
export class ModelCatalogRefresher<T> {
  private catalog: T[]
  private inFlight: Promise<T[]> | null = null
  private refreshedAt: number | undefined
  private readonly freshnessMs: number
  private readonly now: () => number

  constructor(
    initial: T[],
    private readonly discover: () => Promise<T[]>,
    private readonly options: ModelCatalogRefresherOptions<T> = {}
  ) {
    this.catalog = initial
    this.freshnessMs = options.freshnessMs ?? 60_000
    this.now = options.now ?? Date.now
  }

  current(): T[] {
    return this.catalog
  }

  refresh(force = false): Promise<T[]> {
    if (this.inFlight) return this.inFlight
    if (
      !force &&
      this.refreshedAt !== undefined &&
      this.now() - this.refreshedAt < this.freshnessMs
    ) {
      return Promise.resolve(this.catalog)
    }

    this.inFlight = this.discover()
      .then((discovered) => {
        if (discovered.length === 0) return this.catalog
        const next = this.options.reconcile?.(this.catalog, discovered) ?? discovered
        if (next.length === 0) return this.catalog
        this.catalog = next
        this.refreshedAt = this.now()
        this.options.onApply?.(this.catalog)
        return this.catalog
      })
      .catch(() => this.catalog)
      .finally(() => {
        this.inFlight = null
      })

    return this.inFlight
  }
}

/**
 * Les lectures ordinaires restent instantanées pendant le probe de démarrage.
 * Seul un appel explicitement forcé attend le fournisseur.
 */
export function serveModelCatalog<T>(
  refresher: ModelCatalogRefresher<T>,
  force: boolean
): T[] | Promise<T[]> {
  return force ? refresher.refresh(true) : refresher.current()
}
