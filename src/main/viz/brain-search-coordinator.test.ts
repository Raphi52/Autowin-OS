import { describe, expect, it, vi } from 'vitest'
import type { BrainRetrievalResult } from '../brain-retrieval'
import { buildBrainSearchEnvelope } from '../brain-search-envelope'
import type { BrainNoteSearchResult } from './fs-brains'
import { BrainSearchCoordinator, type BrainSearchOperations } from './brain-search-coordinator'

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

  it('degrade en liste vide meme si le demarrage du worker local leve synchroniquement', async () => {
    const coordinator = new BrainSearchCoordinator()

    await expect(
      coordinator.search('C:\\brain', 'decision', {
        searchLocal: () => {
          throw new Error('CREATE_WORKER_FAILED')
        },
        retrieve: async () => ({ context: '', status: 'unavailable' }),
        fuse: async (local) => local
      })
    ).resolves.toEqual([])
  })

  it('conserve les resultats locaux si le retrieval leve synchroniquement', async () => {
    const coordinator = new BrainSearchCoordinator()
    const local: BrainNoteSearchResult[] = [
      {
        id: 'decision',
        label: 'LOCAL',
        file: 'C:\\brain\\decision.md',
        score: 1,
        themes: [],
        relations: []
      }
    ]
    const fuse = vi.fn(async () => [])

    await expect(
      coordinator.search('C:\\brain', 'decision', {
        searchLocal: async () => local,
        retrieve: () => {
          throw new Error('RETRIEVE_SYNC')
        },
        fuse
      })
    ).resolves.toEqual(local)
    expect(fuse).not.toHaveBeenCalled()
  })

  it('conserve les resultats locaux si le retrieval rejette asynchronement', async () => {
    const coordinator = new BrainSearchCoordinator()
    const local: BrainNoteSearchResult[] = [
      {
        id: 'decision',
        label: 'LOCAL',
        file: 'C:\\brain\\decision.md',
        score: 1,
        themes: [],
        relations: []
      }
    ]

    await expect(
      coordinator.search('C:\\brain', 'decision', {
        searchLocal: async () => local,
        retrieve: async () => {
          throw new Error('RETRIEVE_ASYNC')
        },
        fuse: async () => []
      })
    ).resolves.toEqual(local)
  })

  it('transporte le statut retrieval avec les resultats pour la vue Knowledge', async () => {
    const coordinator = new BrainSearchCoordinator()
    const local: BrainNoteSearchResult[] = [
      {
        id: 'decision',
        label: 'LOCAL',
        file: 'C:\\brain\\decision.md',
        score: 1,
        themes: [],
        relations: []
      }
    ]

    await expect(
      coordinator.searchDetailed('C:\\brain', 'decision', {
        searchLocal: async () => local,
        retrieve: async () => ({ context: '', status: 'unavailable' }),
        fuse: async () => []
      })
    ).resolves.toEqual({ results: local, retrieval: { context: '', status: 'unavailable' } })
  })

  it('conserve les resultats locaux si la fusion leve synchroniquement puis recupere', async () => {
    const coordinator = new BrainSearchCoordinator()
    const local: BrainNoteSearchResult[] = [
      {
        id: 'decision',
        label: 'LOCAL',
        file: 'C:\\brain\\decision.md',
        score: 1,
        themes: [],
        relations: []
      }
    ]
    const retrieval: BrainRetrievalResult = {
      context: '',
      status: 'found',
      navigation: { query: 'decision', minDense: 0, root: 'C:\\brain', candidates: [] }
    }

    await expect(
      coordinator.search('C:\\brain', 'decision', {
        searchLocal: async () => local,
        retrieve: async () => retrieval,
        fuse: () => {
          throw new Error('FUSE_SYNC')
        }
      })
    ).resolves.toEqual(local)
    await expect(
      coordinator.search('C:\\brain', 'decision', {
        searchLocal: async () => local,
        retrieve: async () => retrieval,
        fuse: async () => [{ ...local[0], label: 'FUSED' }]
      })
    ).resolves.toMatchObject([{ label: 'FUSED' }])
  })

  it('conserve le statut et la navigation retrieval avec les resultats fusionnes', async () => {
    const coordinator = new BrainSearchCoordinator()
    const local: BrainNoteSearchResult[] = [
      {
        id: 'decision',
        label: 'LOCAL',
        file: 'C:\\brain\\decision.md',
        score: 1,
        themes: [],
        relations: []
      }
    ]
    const retrieval: BrainRetrievalResult = {
      context: 'knowledge',
      status: 'found',
      navigation: { query: 'decision', minDense: 0.2, root: 'C:\\brain', candidates: [] }
    }

    await expect(
      coordinator.searchDetailed('C:\\brain', 'decision', {
        searchLocal: async () => local,
        retrieve: async () => retrieval,
        fuse: async () => [{ ...local[0], label: 'FUSED' }]
      })
    ).resolves.toEqual({ results: [{ ...local[0], label: 'FUSED' }], retrieval })
  })

  it('borne et normalise la meme question avant recherche locale et retrieval', async () => {
    const coordinator = new BrainSearchCoordinator()
    const seenLocal: string[] = []
    const seenRetrieval: string[] = []

    const rawQuery = `  ${'x'.repeat(700)}  `
    const resolution = await coordinator.searchDetailed('C:\\brain', rawQuery, {
      searchLocal: async (_root, query) => {
        seenLocal.push(query)
        return []
      },
      retrieve: async (query) => {
        seenRetrieval.push(query)
        return { context: '', status: 'empty' }
      },
      fuse: async (local) => local
    })

    expect(seenLocal).toEqual(['x'.repeat(500)])
    expect(seenRetrieval).toEqual(['x'.repeat(500)])
    const envelope = buildBrainSearchEnvelope({
      rawQuery,
      results: resolution.results,
      retrieval: resolution.retrieval
    })
    expect(envelope.query).toBe(seenRetrieval[0])
    expect(envelope.budget.questionChars).toBe(seenRetrieval[0].length)
  })

  it('ne lance jamais le retrieval si le vault ne peut pas etre autorise', async () => {
    const coordinator = new BrainSearchCoordinator()
    const retrieve = vi.fn(async (): Promise<BrainRetrievalResult> => ({
      context: 'SECRET',
      status: 'found'
    }))
    const operations = {
      authorize: async () => {
        throw new Error('brain vault hors perimetre autorise')
      },
      searchLocal: async () => [],
      retrieve,
      fuse: async (local: BrainNoteSearchResult[]) => local
    } as BrainSearchOperations & { authorize(root: string): Promise<string> }

    await expect(coordinator.searchDetailed('C:\\outside', 'secret', operations)).rejects.toThrow(
      /hors perimetre/
    )
    expect(retrieve).not.toHaveBeenCalled()
  })
})
