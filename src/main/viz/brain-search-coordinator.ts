import type { BrainNavigation, BrainRetrievalResult } from '../brain-retrieval'
import { decideBrainQuery } from '../brain-query-command'
import type { BrainNoteSearchResult } from './fs-brains'
import { GenerationFence } from './generation-cache'

export interface BrainSearchOperations {
  authorize?(root: string): Promise<string>
  searchLocal(root: string, query: string): Promise<BrainNoteSearchResult[]>
  retrieve(query: string): Promise<BrainRetrievalResult>
  fuse(
    local: BrainNoteSearchResult[],
    navigation: BrainNavigation,
    root: string
  ): Promise<BrainNoteSearchResult[]>
}

export interface BrainSearchResolution {
  results: BrainNoteSearchResult[]
  /** Retrieval exact qui a produit les scores, conservÃ© pour que l'UI distingue vide et panne. */
  retrieval?: BrainRetrievalResult
}

/** Linéarise toute la chaîne recherche locale → retrieval → fusion face à un refresh. */
export class BrainSearchCoordinator {
  private readonly fence = new GenerationFence()

  invalidate(): void {
    this.fence.invalidate()
  }

  async searchDetailed(
    root: string,
    query: string,
    operations: BrainSearchOperations
  ): Promise<BrainSearchResolution> {
    const epochAtStart = this.fence.capture()
    const decision = decideBrainQuery(query)
    if (!decision.allowed) return { results: [] }
    const authorizedRoot = await Promise.resolve().then(() =>
      operations.authorize ? operations.authorize(root) : root
    )
    if (!this.fence.isCurrent(epochAtStart)) return { results: [] }
    const [local, retrieval] = await Promise.all([
      Promise.resolve()
        .then(() => operations.searchLocal(authorizedRoot, decision.query))
        .catch(() => []),
      Promise.resolve()
        .then(() => operations.retrieve(decision.query))
        .catch((): BrainRetrievalResult => ({ context: '', status: 'unavailable' }))
    ])
    if (!this.fence.isCurrent(epochAtStart)) return { results: [] }
    const effectiveRetrieval: BrainRetrievalResult =
      retrieval.navigation && retrieval.navigation.query !== decision.query
        ? { context: '', status: 'invalid' }
        : retrieval
    const navigation = effectiveRetrieval.navigation
    if (local.length === 0 || !navigation) return { results: local, retrieval: effectiveRetrieval }

    const fused = await Promise.resolve()
      .then(() => operations.fuse(local, navigation, authorizedRoot))
      .catch(() => local)
    return this.fence.isCurrent(epochAtStart)
      ? { results: fused, retrieval: effectiveRetrieval }
      : { results: [] }
  }
}
