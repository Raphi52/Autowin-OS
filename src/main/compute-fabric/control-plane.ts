import type { ComputeResource } from '../../shared/compute-fabric'
import {
  loadFabricState,
  saveFabricState,
  type FabricNodeRecord,
  type FabricState
} from './fabric-store'
import { verifyNodeManifest } from './manifest'
import {
  parseFabricNodeTransport,
  type FabricNodeTransport,
  type FabricNodeTransportStore
} from './node-transport-store'
import { FabricResourceAdapter } from './resource-adapter'

export interface PairNodeRequest {
  nodeId: string
  keyId: string
  signingPublicKeyFingerprint: string
  signingPublicKeyPem: string
  transport: FabricNodeTransport
}

export interface FabricManifestClient {
  fetchManifest(transport: FabricNodeTransport): Promise<unknown>
}

export interface FabricNodeSummary {
  nodeId: string
  trust: FabricNodeRecord['trust']
  availability: 'online' | 'offline' | 'unknown'
  lastSequence: number
  lastManifestDigest?: string
  lastVerifiedAt?: string
  resources: ComputeResource[]
}

export interface FabricControlPlaneOptions {
  statePath: string
  manifestClient: FabricManifestClient
  transportStoreFactory: (nodeId: string) => FabricNodeTransportStore
  now?: () => Date
}

interface RuntimeNodeState {
  availability: FabricNodeSummary['availability']
  resources: ComputeResource[]
}

function transportRef(nodeId: string): string {
  return `fabric-node:${nodeId}`
}

export class FabricControlPlane {
  private state: FabricState
  private readonly runtime = new Map<string, RuntimeNodeState>()
  private readonly transportStores = new Map<string, FabricNodeTransportStore>()
  private readonly now: () => Date

  constructor(private readonly options: FabricControlPlaneOptions) {
    this.state = loadFabricState(options.statePath)
    this.now = options.now ?? (() => new Date())
  }

  list(): FabricNodeSummary[] {
    return this.state.nodes.map((node) => this.summary(node))
  }

  async pair(request: PairNodeRequest): Promise<FabricNodeSummary> {
    if (this.state.nodes.some((node) => node.nodeId === request.nodeId)) {
      throw new Error(`Nœud Compute Fabric déjà connu: ${request.nodeId}`)
    }
    const transport = parseFabricNodeTransport(request.transport)
    const manifestValue = await this.options.manifestClient.fetchManifest(transport)
    const verified = verifyNodeManifest(
      manifestValue,
      {
        nodeId: request.nodeId,
        keyId: request.keyId,
        signingPublicKeyFingerprint: request.signingPublicKeyFingerprint,
        signingPublicKeyPem: request.signingPublicKeyPem
      },
      { now: this.now(), lastSequence: 0 }
    )
    const verifiedAt = this.now().toISOString()
    const node: FabricNodeRecord = {
      nodeId: request.nodeId,
      keyId: request.keyId,
      signingPublicKeyFingerprint: request.signingPublicKeyFingerprint,
      signingPublicKeyPem: request.signingPublicKeyPem,
      transportRef: transportRef(request.nodeId),
      trust: 'paired',
      lastSequence: verified.manifest.sequence,
      lastManifestDigest: verified.manifestDigest,
      lastVerifiedAt: verifiedAt
    }
    const transportStore = this.transportStore(request.nodeId)
    transportStore.set(transport)
    try {
      const next = { ...this.state, nodes: [...this.state.nodes, node] }
      this.state = saveFabricState(this.options.statePath, next)
    } catch (error) {
      transportStore.delete()
      throw error
    }
    this.runtime.set(node.nodeId, {
      availability: 'online',
      resources: verified.resources
    })
    return this.summary(node)
  }

  async refresh(nodeId: string): Promise<FabricNodeSummary> {
    const current = this.state.nodes.find((node) => node.nodeId === nodeId)
    if (!current) throw new Error(`Nœud Compute Fabric inconnu: ${nodeId}`)
    if (current.trust !== 'paired') throw new Error(`Nœud Compute Fabric révoqué: ${nodeId}`)
    const transport = this.transportStore(nodeId).get()
    if (!transport) {
      this.runtime.set(nodeId, { availability: 'offline', resources: [] })
      throw new Error(`Transport du Node indisponible: ${nodeId}`)
    }
    try {
      const manifestValue = await this.options.manifestClient.fetchManifest(transport)
      const now = this.now()
      const verified = verifyNodeManifest(
        manifestValue,
        {
          nodeId: current.nodeId,
          keyId: current.keyId,
          signingPublicKeyFingerprint: current.signingPublicKeyFingerprint,
          signingPublicKeyPem: current.signingPublicKeyPem
        },
        { now, lastSequence: current.lastSequence }
      )
      const updated: FabricNodeRecord = {
        ...current,
        lastSequence: verified.manifest.sequence,
        lastManifestDigest: verified.manifestDigest,
        lastVerifiedAt: now.toISOString()
      }
      const next = {
        ...this.state,
        nodes: this.state.nodes.map((node) => (node.nodeId === nodeId ? updated : node))
      }
      this.state = saveFabricState(this.options.statePath, next)
      this.runtime.set(nodeId, { availability: 'online', resources: verified.resources })
      return this.summary(updated)
    } catch (error) {
      this.runtime.set(nodeId, { availability: 'offline', resources: [] })
      throw error
    }
  }

  createLocalToolsAdapter(nodeId: string, resourceId: string): FabricResourceAdapter {
    const node = this.state.nodes.find((candidate) => candidate.nodeId === nodeId)
    if (!node || node.trust !== 'paired' || !node.lastManifestDigest) {
      throw new Error(`Nœud Compute Fabric non appairé: ${nodeId}`)
    }
    const runtime = this.runtime.get(nodeId)
    if (runtime?.availability !== 'online') {
      throw new Error(`Nœud Compute Fabric hors ligne: ${nodeId}`)
    }
    const resource = runtime.resources.find((candidate) => candidate.id === resourceId)
    if (!resource || !resource.modes.includes('local-tools')) {
      throw new Error(`Ressource local-tools indisponible: ${nodeId}/${resourceId}`)
    }
    return new FabricResourceAdapter({
      nodeId,
      resourceId,
      manifestDigest: node.lastManifestDigest,
      transportStore: this.transportStore(nodeId)
    })
  }

  private transportStore(nodeId: string): FabricNodeTransportStore {
    const existing = this.transportStores.get(nodeId)
    if (existing) return existing
    const created = this.options.transportStoreFactory(nodeId)
    this.transportStores.set(nodeId, created)
    return created
  }

  private summary(node: FabricNodeRecord): FabricNodeSummary {
    const runtime = this.runtime.get(node.nodeId)
    return {
      nodeId: node.nodeId,
      trust: node.trust,
      availability: runtime?.availability ?? 'unknown',
      lastSequence: node.lastSequence,
      ...(node.lastManifestDigest ? { lastManifestDigest: node.lastManifestDigest } : {}),
      ...(node.lastVerifiedAt ? { lastVerifiedAt: node.lastVerifiedAt } : {}),
      resources: runtime?.resources ?? []
    }
  }
}
