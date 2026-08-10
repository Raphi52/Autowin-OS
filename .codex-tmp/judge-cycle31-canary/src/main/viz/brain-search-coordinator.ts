import type { BrainNavigation, BrainRetrievalResult } from '../brain-retrieval'
import type { BrainNoteSearchResult } from './fs-brains'
import { GenerationFence } from './generation-cache'

export interface BrainSearchOperations {
  searchLocal(root: string, query: string): Promise<BrainNoteSearchResult[]>
  retrieve(query: string): Promise<BrainRetrievalResult>
  fuse(
    local: BrainNoteSearchResult[],
    navigation: BrainNavigation,
    root: string
  ): Promise<BrainNoteSearchResult[]>
}

/** Linéarise toute la chaîne recherche locale → retrieval → fusion face à un refresh. */
export class BrainSearchCoordinator {
  private readonly fence = new GenerationFence()

  invalidate(): void {
    this.fence.invalidate()
  }

  async search(
    root: string,
    query: string,
    operations: BrainSearchOperations
  ): Promise<BrainNoteSearchResult[]> {
    const epochAtStart = this.fence.capture()
    const [local, retrieval] = await Promise.all([
      operations.searchLocal(root, query).catch(() => []),
      operations.retrieve(query)
    ])
    if (!this.fence.isCurrent(epochAtStart)) return []
    if (local.length === 0 || !retrieval.navigation) return local

    const fused = await operations.fuse(local, retrieval.navigation, root).catch(() => local)
    return this.fence.isCurrent(epochAtStart) ? fused : []
  }
}
