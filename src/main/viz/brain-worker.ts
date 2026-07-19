import { parentPort } from 'node:worker_threads'
import {
  loadBrainGraph,
  loadBrainGraphAsync,
  loadBrainGraphPreviewAsync,
  loadBrainNeighborhood,
  loadBrainThemes,
  readNodeFile,
  scanBrainGraphs,
  searchVaultBrainNotes
} from './fs-brains'

type BrainWorkerRequest = {
  id: number
  method:
    | 'listBrains'
    | 'loadPreview'
    | 'loadGraph'
    | 'loadThemes'
    | 'loadNeighborhood'
    | 'readNodeFile'
    | 'searchBrain'
  args: unknown[]
}

if (!parentPort) throw new Error('brain-worker doit être exécuté dans un Worker')

const graphCache = new Map<string, ReturnType<typeof loadBrainGraph>>()
const neighborhoodCache = new Map<string, ReturnType<typeof loadBrainNeighborhood>>()

parentPort.on('message', async (request: BrainWorkerRequest) => {
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
          value = await loadBrainGraphAsync(path, lod, community)
          graphCache.set(key, value as ReturnType<typeof loadBrainGraph>)
        }
        break
      }
      case 'loadThemes':
        value = loadBrainThemes(request.args[0] as string)
        break
      case 'loadNeighborhood': {
        const [path, nodeId] = request.args as [string, string]
        const key = `${path}\u0000${nodeId}`
        value = neighborhoodCache.get(key)
        if (!value) {
          value = loadBrainNeighborhood(path, nodeId)
          neighborhoodCache.set(key, value as ReturnType<typeof loadBrainNeighborhood>)
        }
        break
      }
      case 'readNodeFile':
        value = readNodeFile(request.args[0] as string)
        break
      case 'searchBrain':
        value = searchVaultBrainNotes(request.args[0] as string, request.args[1] as string)
        break
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
