import { parentPort } from 'node:worker_threads'
import { graphifyEvidence } from '../amitel-context'
import type { BrainNavigation } from '../brain-retrieval'
import {
  applyBrainRetrievalScoresAsync,
  assertAuthorizedBrainVaultAsync,
  loadBrainGraph,
  loadBrainGraphAsync,
  loadBrainGraphPreviewAsync,
  loadBrainNeighborhood,
  loadBrainThemeNodes,
  loadBrainThemes,
  invalidateBrainCaches,
  readNodeFile,
  scanBrainGraphs,
  searchVaultBrainNotesAsync,
  type BrainNoteSearchResult
} from './fs-brains'
import { GenerationCache, GenerationFence } from './generation-cache'

type BrainWorkerRequest = {
  id: number
  method:
    | 'listBrains'
    | 'loadPreview'
    | 'loadGraph'
    | 'loadThemes'
    | 'loadThemeNodes'
    | 'loadNeighborhood'
    | 'readNodeFile'
    | 'authorizeVault'
    | 'searchBrain'
    | 'fuseRetrieval'
    | 'invalidate'
    | 'graphifyEvidence'
  args: unknown[]
}

if (!parentPort) throw new Error('brain-worker doit être exécuté dans un Worker')

const graphCache = new GenerationCache<string, ReturnType<typeof loadBrainGraph>>()
const neighborhoodCache = new GenerationCache<string, ReturnType<typeof loadBrainNeighborhood>>()
const responseFence = new GenerationFence()

parentPort.on('message', async (request: BrainWorkerRequest) => {
  const epochAtStart = responseFence.capture()
  try {
    let value: unknown
    switch (request.method) {
      case 'listBrains':
        value = scanBrainGraphs(undefined, undefined, false)
        break
      case 'loadPreview':
        value = await loadBrainGraphPreviewAsync(
          request.args[0] as string,
          request.args[1] as number | undefined
        )
        break
      case 'loadGraph': {
        const [path, lod, community] = request.args as [
          string,
          number | undefined,
          number | undefined
        ]
        const key = `${path}\u0000${lod ?? 300}\u0000${community ?? ''}`
        value = graphCache.get(key)
        if (!value) {
          const lease = graphCache.capture(key)
          try {
            value = await loadBrainGraphAsync(path, lod, community)
            if (!graphCache.publish(lease, value as ReturnType<typeof loadBrainGraph>)) {
              throw new Error('cache Brain invalidé pendant le chargement')
            }
          } catch (error) {
            graphCache.abandon(lease)
            throw error
          }
        }
        break
      }
      case 'loadThemes':
        value = loadBrainThemes(request.args[0] as string)
        break
      case 'loadThemeNodes':
        value = loadBrainThemeNodes(request.args[0] as string, request.args[1] as string[])
        break
      case 'loadNeighborhood': {
        const [path, nodeId] = request.args as [string, string]
        const key = `${path}\u0000${nodeId}`
        value = neighborhoodCache.get(key)
        if (!value) {
          const lease = neighborhoodCache.capture(key)
          try {
            value = loadBrainNeighborhood(path, nodeId)
            if (
              !neighborhoodCache.publish(lease, value as ReturnType<typeof loadBrainNeighborhood>)
            ) {
              throw new Error('cache Brain invalidé pendant le chargement')
            }
          } catch (error) {
            neighborhoodCache.abandon(lease)
            throw error
          }
        }
        break
      }
      case 'readNodeFile':
        value = readNodeFile(request.args[0] as string)
        break
      case 'authorizeVault':
        value = await assertAuthorizedBrainVaultAsync(request.args[0] as string)
        break
      case 'searchBrain':
        value = await searchVaultBrainNotesAsync(
          request.args[0] as string,
          request.args[1] as string
        )
        break
      case 'fuseRetrieval':
        value = await applyBrainRetrievalScoresAsync(
          request.args[0] as BrainNoteSearchResult[],
          request.args[1] as BrainNavigation | undefined,
          request.args[2] as string | undefined
        )
        break
      case 'invalidate':
        responseFence.invalidate()
        graphCache.invalidate()
        neighborhoodCache.invalidate()
        // Le worker n'autorise qu'un vault de notes : un vidage total couvre les alias équivalents,
        // y compris ceux qui n'avaient encore jamais servi de clé.
        invalidateBrainCaches()
        value = true
        break
      case 'graphifyEvidence':
        value = graphifyEvidence(
          request.args[0] as string,
          request.args[1] as string,
          request.args[2] as number
        )
        break
    }
    if (request.method !== 'invalidate' && !responseFence.isCurrent(epochAtStart)) {
      throw new Error('réponse Brain invalidée pendant le chargement')
    }
    parentPort?.postMessage({ id: request.id, ok: true, value })
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
