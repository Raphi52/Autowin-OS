import { describe, expect, it, vi } from 'vitest'
import type { BrainRetrievalResult } from '../brain-retrieval'
import type { BrainNoteSearchResult } from './fs-brains'
import { BrainSearchCoordinator } from './brain-search-coordinator'

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

describe('BrainSearchCoordinator', () => {
  it('ne rend pas un resultat local capture avant un refresh intercale avant la fusion', async () => {
    const coordinator = new BrainSearchCoordinator()
    const retrieval = deferred<BrainRetrievalResult>()
    const localCaptured = deferred<void>()
    const oldLocal: BrainNoteSearchResult[] = [
      {
        id: 'decision',
        label: 'OLD LABEL',
        file: 'C:\\brain\\decision.md',
        score: 1,
        themes: [],
        relations: []
      }
    ]
    const searchLocal = vi.fn(async () => {
      localCaptured.resolve()
      return oldLocal
    })
    const fuse = vi.fn(async () => oldLocal)

    const pending = coordinator.search('C:\\brain', 'decision', {
      searchLocal,
      retrieve: () => retrieval.promise,
      fuse
    })
    await localCaptured.promise

    coordinator.invalidate()
    retrieval.resolve({
      context: '',
      status: 'found',
      navigation: { query: 'decision', minDense: 0, root: 'C:\\brain', candidates: [] }
    })

    await expect(pending).resolves.toEqual([])
    expect(fuse).not.toHaveBeenCalled()
  })

  it('ne rend pas une fusion terminee apres le refresh', async () => {
    const coordinator = new BrainSearchCoordinator()
    const fusion = deferred<BrainNoteSearchResult[]>()
    const fusionStarted = deferred<void>()
    const oldLocal: BrainNoteSearchResult[] = [
      {
        id: 'decision',
        label: 'OLD LABEL',
        file: 'C:\\brain\\decision.md',
        score: 1,
        themes: [],
        relations: []
      }
    ]

    const pending = coordinator.search('C:\\brain', 'decision', {
      searchLocal: async () => oldLocal,
      retrieve: async () => ({
        context: '',
        status: 'found',
        navigation: { query: 'decision', minDense: 0, root: 'C:\\brain', candidates: [] }
      }),
      fuse: () => {
        fusionStarted.resolve()
        return fusion.promise
      }
    })
    await fusionStarted.promise

    coordinator.invalidate()
    fusion.resolve(oldLocal)

    await expect(pending).resolves.toEqual([])
  })
})
