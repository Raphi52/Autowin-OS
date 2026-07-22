export const NODE_MANIFEST_SCHEMA = 'autowin.node-manifest/v1' as const

export type ComputeExecutionMode = 'local-tools' | 'remote-agent'
export type ComputeResourceKind = 'model' | 'agent'

export interface NodeProtocolRange {
  min: number
  max: number
}

export interface ComputeNodeIdentity {
  id: string
  keyId: string
  signingPublicKeyFingerprint: string
  bootId: string
}

export interface RuntimeAdapterDescriptor {
  id: string
  version: string
}

export interface ComputeResourceLimits {
  contextTokens: number
  maxConcurrentRuns: number
}

export interface NodeManifestResource {
  id: string
  kind: ComputeResourceKind
  adapterId: string
  displayName: string
  runtimeVersion: string
  modes: ComputeExecutionMode[]
  capabilities: string[]
  limits: ComputeResourceLimits
}

export interface ComputeResource extends NodeManifestResource {
  nodeId: string
}

export interface NodeManifestSignature {
  algorithm: 'Ed25519'
  keyId: string
  value: string
}

export interface NodeManifest {
  schema: typeof NODE_MANIFEST_SCHEMA
  protocol: NodeProtocolRange
  node: ComputeNodeIdentity
  sequence: number
  issuedAt: string
  expiresAt: string
  adapters: RuntimeAdapterDescriptor[]
  resources: NodeManifestResource[]
  signature: NodeManifestSignature
}

export interface ComputeBinding {
  kind: 'fabric'
  nodeId: string
  resourceId: string
  mode: ComputeExecutionMode
  policyRef: string
  manifestDigest: string
  fallback: { kind: 'none' }
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} invalide`)
  }
  return value as Record<string, unknown>
}

function exactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string
): void {
  const allowedKeys = new Set(allowed)
  const unknown = Object.keys(value).find((key) => !allowedKeys.has(key))
  if (unknown) throw new Error(`Champ inconnu dans ${label}: ${unknown}`)
}

function text(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.length > 256 ||
    [...value].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code < 32 || code === 127
    })
  ) {
    throw new Error(`${label} invalide`)
  }
  return value
}

function positiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) <= 0) {
    throw new Error(`${label} invalide`)
  }
  return value as number
}

function stringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.length > 64) {
    throw new Error(`${label} invalide`)
  }
  return value.map((entry) => text(entry, label))
}

export function parseNodeManifest(value: unknown): NodeManifest {
  const raw = record(value, 'Manifeste Node')
  exactKeys(
    raw,
    [
      'schema',
      'protocol',
      'node',
      'sequence',
      'issuedAt',
      'expiresAt',
      'adapters',
      'resources',
      'signature'
    ],
    'le manifeste Node'
  )
  if (raw.schema !== NODE_MANIFEST_SCHEMA) throw new Error('Schéma de manifeste Node inconnu')

  const protocol = record(raw.protocol, 'Protocole Node')
  const node = record(raw.node, 'Identité Node')
  exactKeys(protocol, ['min', 'max'], 'protocol')
  exactKeys(node, ['id', 'keyId', 'signingPublicKeyFingerprint', 'bootId'], 'node')
  const nodeId = identifier(node.id, 'node.id')
  const protocolMin = positiveInteger(protocol.min, 'protocol.min')
  const protocolMax = positiveInteger(protocol.max, 'protocol.max')
  if (protocolMin > 1 || protocolMax < 1 || protocolMin > protocolMax) {
    throw new Error('Plage de protocole Node incompatible avec v1')
  }
  const adapters = Array.isArray(raw.adapters)
    ? raw.adapters.map((entry) => {
        const adapter = record(entry, 'Adaptateur runtime')
        exactKeys(adapter, ['id', 'version'], 'adapter')
        return {
          id: identifier(adapter.id, 'adapter.id'),
          version: text(adapter.version, 'adapter.version')
        }
      })
    : (() => {
        throw new Error('Adaptateurs runtime invalides')
      })()
  const resources = Array.isArray(raw.resources)
    ? raw.resources.map((entry) => {
        const resource = record(entry, 'Ressource Compute')
        const limits = record(resource.limits, 'Limites de ressource')
        exactKeys(
          resource,
          [
            'id',
            'kind',
            'adapterId',
            'displayName',
            'runtimeVersion',
            'modes',
            'capabilities',
            'limits'
          ],
          'resource'
        )
        exactKeys(limits, ['contextTokens', 'maxConcurrentRuns'], 'resource.limits')
        const kindValue = text(resource.kind, 'resource.kind')
        const kind: ComputeResourceKind =
          kindValue === 'model' || kindValue === 'agent'
            ? kindValue
            : (() => {
                throw new Error('Type de ressource inconnu')
              })()
        const modes = stringList(resource.modes, 'resource.modes')
        if (modes.some((mode) => mode !== 'local-tools' && mode !== 'remote-agent')) {
          throw new Error('Mode d’exécution inconnu')
        }
        const capabilities = stringList(resource.capabilities, 'resource.capabilities')
        if (
          modes.includes('remote-agent') &&
          (kind !== 'agent' ||
            !capabilities.includes('agent.read-only') ||
            !capabilities.includes('workspace.read') ||
            !capabilities.includes('evidence.signed'))
        ) {
          throw new Error('remote-agent exige une ressource agent read-only avec preuve signée')
        }
        return {
          id: identifier(resource.id, 'resource.id'),
          kind,
          adapterId: identifier(resource.adapterId, 'resource.adapterId'),
          displayName: text(resource.displayName, 'resource.displayName'),
          runtimeVersion: text(resource.runtimeVersion, 'resource.runtimeVersion'),
          modes: modes as ComputeExecutionMode[],
          capabilities,
          limits: {
            contextTokens: positiveInteger(limits.contextTokens, 'limits.contextTokens'),
            maxConcurrentRuns: positiveInteger(limits.maxConcurrentRuns, 'limits.maxConcurrentRuns')
          }
        }
      })
    : (() => {
        throw new Error('Ressources Compute invalides')
      })()
  const adapterIds = new Set<string>()
  for (const adapter of adapters) {
    if (adapterIds.has(adapter.id)) throw new Error('Identité d’adaptateur dupliquée')
    adapterIds.add(adapter.id)
  }
  const resourceIds = new Set<string>()
  for (const resource of resources) {
    if (resourceIds.has(resource.id)) throw new Error('Identité de ressource dupliquée')
    if (!adapterIds.has(resource.adapterId)) {
      throw new Error('Ressource liée à un adaptateur non déclaré')
    }
    resourceIds.add(resource.id)
  }
  const signature = record(raw.signature, 'Signature du manifeste')
  exactKeys(signature, ['algorithm', 'keyId', 'value'], 'signature')
  if (signature.algorithm !== 'Ed25519') throw new Error('Algorithme de signature inconnu')

  return {
    schema: NODE_MANIFEST_SCHEMA,
    protocol: {
      min: protocolMin,
      max: protocolMax
    },
    node: {
      id: nodeId,
      keyId: identifier(node.keyId, 'node.keyId'),
      signingPublicKeyFingerprint: text(
        node.signingPublicKeyFingerprint,
        'node.signingPublicKeyFingerprint'
      ),
      bootId: identifier(node.bootId, 'node.bootId')
    },
    sequence: positiveInteger(raw.sequence, 'sequence'),
    issuedAt: text(raw.issuedAt, 'issuedAt'),
    expiresAt: text(raw.expiresAt, 'expiresAt'),
    adapters,
    resources,
    signature: {
      algorithm: 'Ed25519',
      keyId: identifier(signature.keyId, 'signature.keyId'),
      value: text(signature.value, 'signature.value')
    }
  }
}

function identifier(value: unknown, label: string): string {
  const result = text(value, label)
  if (result.length > 128 || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(result)) {
    throw new Error(`${label} invalide`)
  }
  return result
}

export function parseComputeBinding(value: unknown): ComputeBinding {
  const raw = record(value, 'Binding Compute Fabric')
  exactKeys(
    raw,
    ['kind', 'nodeId', 'resourceId', 'mode', 'policyRef', 'manifestDigest', 'fallback'],
    'le binding Compute Fabric'
  )
  if (raw.kind !== 'fabric') throw new Error('Type de binding Compute inconnu')
  if (raw.mode !== 'local-tools' && raw.mode !== 'remote-agent') {
    throw new Error('Mode de binding Compute inconnu')
  }
  if (typeof raw.manifestDigest !== 'string' || !/^[a-f0-9]{64}$/.test(raw.manifestDigest)) {
    throw new Error('Digest de manifeste invalide')
  }
  const fallback = record(raw.fallback, 'Fallback Compute')
  exactKeys(fallback, ['kind'], 'le fallback Compute')
  if (fallback.kind !== 'none') throw new Error('Fallback Compute non explicite ou inconnu')

  return {
    kind: 'fabric',
    nodeId: identifier(raw.nodeId, 'binding.nodeId'),
    resourceId: identifier(raw.resourceId, 'binding.resourceId'),
    mode: raw.mode,
    policyRef: identifier(raw.policyRef, 'binding.policyRef'),
    manifestDigest: raw.manifestDigest,
    fallback: { kind: 'none' }
  }
}
