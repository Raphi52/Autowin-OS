import { parentPort } from 'node:worker_threads'
import { graphifyEvidence } from '../amitel-context'
import { listInboxCandidates, readInboxCandidateBody } from '../brain-inbox'
import { resolveHeadShas } from '../brain-source-sha'
import {
  applyBrainRetrievalScoresAsync,
  assertAuthorizedBrainVaultAsync,
  loadBrainGraph,
  loadBrainGraphAsync,
  loadBrainGraphPreviewAsync,
  loadBrainNeighborhood,
  loadBrainThemeNodes,
  loadBrainThemes,
  readNodeFile,
  scanBrainGraphs,
  searchVaultBrainNotesAsync
} from './fs-brains'
import type { BrainWorkerRequest } from './brain-worker-contract'

if (!parentPort) throw new Error('brain-worker doit être exécuté dans un Worker')

const graphCache = new Map<string, ReturnType<typeof loadBrainGraph>>()
const neighborhoodCache = new Map<string, ReturnType<typeof loadBrainNeighborhood>>()

/*
 * BATTEMENT DU WORKER — mesure du 2026-09-08 : la premiere lecture du Brain sur un partage RESEAU
 * depasse le delai fixe du client, qui tuait alors le worker AVEC son cache. L'essai suivant
 * repartait de zero et echouait pareil : un echec garanti. Le worker dit donc « je travaille »
 * pendant le traitement ; le client n'abandonne plus que sur un SILENCE.
 */
const BATTEMENT_WORKER_MS = 2_000

parentPort.on('message', async (request: BrainWorkerRequest) => {
  // Le signe de vie n'a PAS d'id : le worker traite en SERIE, donc pendant qu'il travaille sur une
  // requete, toutes les autres attendent dans sa file sans recevoir quoi que ce soit. Un battement
  // adresse a la seule requete en cours laissait donc expirer toutes les suivantes (mesure du
  // 2026-09-08 : premiere lecture reseau de 22 898 ms, les appels concurrents mouraient a 30 s).
  const battement = setInterval(() => {
    parentPort?.postMessage({ vivant: true })
  }, BATTEMENT_WORKER_MS)
  battement.unref?.()
  try {
    let value: unknown
    switch (request.method) {
      case 'listBrains':
        value = scanBrainGraphs(undefined, undefined, false)
        break
      case 'loadPreview':
        value = await loadBrainGraphPreviewAsync(request.args[0], request.args[1], request.args[2])
        break
      case 'loadGraph': {
        const [path, lod, community, corpus] = request.args
        const key = `${path}\u0000${lod ?? 300}\u0000${community ?? ''}\u0000${JSON.stringify(corpus)}`
        value = graphCache.get(key)
        if (!value) {
          value = await loadBrainGraphAsync(path, lod, community, corpus)
          graphCache.set(key, value as ReturnType<typeof loadBrainGraph>)
        }
        break
      }
      case 'loadThemes':
        value = loadBrainThemes(request.args[0], request.args[1])
        break
      case 'loadThemeNodes':
        value = loadBrainThemeNodes(request.args[0], request.args[1], request.args[2])
        break
      case 'loadNeighborhood': {
        const [path, nodeId, corpus] = request.args
        const key = `${path}\u0000${nodeId}\u0000${JSON.stringify(corpus)}`
        value = neighborhoodCache.get(key)
        if (!value) {
          value = loadBrainNeighborhood(path, nodeId, corpus)
          neighborhoodCache.set(key, value as ReturnType<typeof loadBrainNeighborhood>)
        }
        break
      }
      case 'readNodeFile':
        value = readNodeFile(request.args[0], request.args[1], request.args[2])
        break
      case 'authorizeVault':
        value = await assertAuthorizedBrainVaultAsync(request.args[0])
        break
      case 'searchBrain':
        value = await searchVaultBrainNotesAsync(request.args[0], request.args[1], {
          corpus: request.args[2]
        })
        break
      case 'fuseRetrieval':
        value = await applyBrainRetrievalScoresAsync(
          request.args[0],
          request.args[1],
          request.args[2]
        )
        break
      case 'graphifyEvidence':
        value = graphifyEvidence(request.args[0], request.args[1], request.args[2])
        break
      case 'listInbox': {
        const [root, workspaces] = request.args
        value = listInboxCandidates(root, {
          headShasFor: (paths) => resolveHeadShas(workspaces, paths)
        })
        break
      }
      case 'readInboxCandidateBody':
        value = readInboxCandidateBody(request.args[0], request.args[1])
        break
      default: {
        const exhaustive: never = request
        throw new Error(`méthode Brain inconnue : ${String(exhaustive)}`)
      }
    }
    parentPort?.postMessage({ id: request.id, ok: true, value })
  } catch (error) {
    parentPort?.postMessage({
      id: request.id,
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    })
  } finally {
    clearInterval(battement)
  }
})
