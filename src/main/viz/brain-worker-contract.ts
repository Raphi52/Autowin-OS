import type { InboxCandidate } from '../brain-inbox'
import type { BrainNavigation } from '../brain-retrieval'
import type { BrainNoteSearchResult } from './fs-brains'

type AsyncResult<T extends (...args: never[]) => unknown> = Awaited<ReturnType<T>>

/** Contrat unique du Worker Brain : chaque méthode lie son tuple d'arguments à son résultat. */
export interface BrainWorkerContract {
  listBrains: {
    args: []
    result: ReturnType<typeof import('./fs-brains').scanBrainGraphs>
  }
  loadPreview: {
    args: [path: string, lod?: number, corpus?: readonly string[]]
    result: AsyncResult<typeof import('./fs-brains').loadBrainGraphPreviewAsync>
  }
  loadGraph: {
    args: [path: string, lod?: number, community?: number, corpus?: readonly string[]]
    result: AsyncResult<typeof import('./fs-brains').loadBrainGraphAsync>
  }
  loadThemes: {
    args: [path: string, corpus?: readonly string[]]
    result: ReturnType<typeof import('./fs-brains').loadBrainThemes>
  }
  loadThemeNodes: {
    args: [path: string, themeIds: string[], corpus?: readonly string[]]
    result: ReturnType<typeof import('./fs-brains').loadBrainThemeNodes>
  }
  loadNeighborhood: {
    args: [path: string, nodeId: string, corpus?: readonly string[]]
    result: ReturnType<typeof import('./fs-brains').loadBrainNeighborhood>
  }
  readNodeFile: {
    args: [path: string, vaultRoot?: string, corpus?: readonly string[]]
    result: ReturnType<typeof import('./fs-brains').readNodeFile>
  }
  authorizeVault: {
    args: [root: string]
    result: AsyncResult<typeof import('./fs-brains').assertAuthorizedBrainVaultAsync>
  }
  searchBrain: {
    args: [root: string, query: string, corpus?: readonly string[]]
    result: BrainNoteSearchResult[]
  }
  fuseRetrieval: {
    args: [local: BrainNoteSearchResult[], navigation?: BrainNavigation, root?: string]
    result: BrainNoteSearchResult[]
  }
  graphifyEvidence: {
    args: [raw: string, query: string, limit: number]
    result: ReturnType<typeof import('../amitel-context').graphifyEvidence>
  }
  listInbox: {
    args: [root: string, workspaces: string[]]
    result: InboxCandidate[]
  }
  readInboxCandidateBody: {
    args: [root: string, id: string]
    result: ReturnType<typeof import('../brain-inbox').readInboxCandidateBody>
  }
}

export type BrainWorkerMethod = keyof BrainWorkerContract
export type BrainWorkerArgs<M extends BrainWorkerMethod> = BrainWorkerContract[M]['args']
export type BrainWorkerResult<M extends BrainWorkerMethod> = BrainWorkerContract[M]['result']
export type BrainWorkerRequest = {
  [M in BrainWorkerMethod]: { id: number; method: M; args: BrainWorkerArgs<M> }
}[BrainWorkerMethod]
