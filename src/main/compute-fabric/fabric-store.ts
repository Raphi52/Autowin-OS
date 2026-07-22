import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export const FABRIC_STATE_SCHEMA = 'autowin.fabric-state/v1' as const

export interface FabricNodeRecord {
  nodeId: string
  keyId: string
  signingPublicKeyFingerprint: string
  signingPublicKeyPem: string
  transportRef: string
  trust: 'paired' | 'revoked'
  lastSequence: number
  lastManifestDigest?: string
  lastVerifiedAt?: string
}

export interface FabricState {
  schema: typeof FABRIC_STATE_SCHEMA
  nodes: FabricNodeRecord[]
}

const EMPTY_STATE: FabricState = { schema: FABRIC_STATE_SCHEMA, nodes: [] }
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/

export class FabricStateCorruptionError extends Error {
  readonly code = 'FABRIC_STATE_CORRUPT' as const
  readonly statePath: string

  constructor(statePath: string, cause: unknown) {
    super(`État Compute Fabric corrompu ou illisible: ${statePath}`, { cause })
    this.name = 'FabricStateCorruptionError'
    this.statePath = statePath
  }
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
  const allowedSet = new Set(allowed)
  const unexpected = Object.keys(value).find((key) => !allowedSet.has(key))
  if (unexpected) throw new Error(`Champ inconnu dans ${label}: ${unexpected}`)
}

function identifier(value: unknown, label: string): string {
  if (typeof value !== 'string' || !IDENTIFIER.test(value)) throw new Error(`${label} invalide`)
  return value
}

function digest(value: unknown, label: string): string {
  if (typeof value !== 'string' || !SHA256.test(value)) throw new Error(`${label} invalide`)
  return value
}

function parseNode(value: unknown): FabricNodeRecord {
  const raw = record(value, 'nœud Fabric')
  exactKeys(
    raw,
    [
      'nodeId',
      'keyId',
      'signingPublicKeyFingerprint',
      'signingPublicKeyPem',
      'transportRef',
      'trust',
      'lastSequence',
      'lastManifestDigest',
      'lastVerifiedAt'
    ],
    'le nœud Fabric'
  )
  if (raw.trust !== 'paired' && raw.trust !== 'revoked') {
    throw new Error('État de confiance Fabric invalide')
  }
  if (!Number.isSafeInteger(raw.lastSequence) || (raw.lastSequence as number) < 0) {
    throw new Error('Séquence Fabric invalide')
  }
  if (
    typeof raw.signingPublicKeyPem !== 'string' ||
    raw.signingPublicKeyPem.length > 8192 ||
    !raw.signingPublicKeyPem.startsWith('-----BEGIN PUBLIC KEY-----\n') ||
    !raw.signingPublicKeyPem.endsWith('-----END PUBLIC KEY-----\n')
  ) {
    throw new Error('Clé publique Fabric invalide')
  }

  const hasDigest = raw.lastManifestDigest !== undefined
  const hasVerifiedAt = raw.lastVerifiedAt !== undefined
  if (hasDigest !== hasVerifiedAt) throw new Error('Checkpoint de manifeste Fabric incomplet')
  if (
    hasVerifiedAt &&
    (typeof raw.lastVerifiedAt !== 'string' ||
      new Date(raw.lastVerifiedAt).toISOString() !== raw.lastVerifiedAt)
  ) {
    throw new Error('Date de vérification Fabric invalide')
  }

  return {
    nodeId: identifier(raw.nodeId, 'nodeId'),
    keyId: identifier(raw.keyId, 'keyId'),
    signingPublicKeyFingerprint: digest(
      raw.signingPublicKeyFingerprint,
      'fingerprint de clé publique'
    ),
    signingPublicKeyPem: raw.signingPublicKeyPem,
    transportRef: identifier(raw.transportRef, 'transportRef'),
    trust: raw.trust,
    lastSequence: raw.lastSequence as number,
    ...(hasDigest
      ? {
          lastManifestDigest: digest(raw.lastManifestDigest, 'digest de manifeste'),
          lastVerifiedAt: raw.lastVerifiedAt as string
        }
      : {})
  }
}

export function parseFabricState(value: unknown): FabricState {
  const raw = record(value, 'état Compute Fabric')
  exactKeys(raw, ['schema', 'nodes'], "l'état Compute Fabric")
  if (raw.schema !== FABRIC_STATE_SCHEMA || !Array.isArray(raw.nodes) || raw.nodes.length > 64) {
    throw new Error('État Compute Fabric invalide')
  }
  const nodes = raw.nodes.map(parseNode)
  const nodeIds = new Set<string>()
  const transportRefs = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.nodeId)) throw new Error(`Nœud Fabric dupliqué: ${node.nodeId}`)
    if (transportRefs.has(node.transportRef)) {
      throw new Error(`Référence de transport Fabric dupliquée: ${node.transportRef}`)
    }
    nodeIds.add(node.nodeId)
    transportRefs.add(node.transportRef)
  }
  return { schema: FABRIC_STATE_SCHEMA, nodes }
}

export function loadFabricState(path: string): FabricState {
  if (!existsSync(path)) return structuredClone(EMPTY_STATE)
  try {
    return parseFabricState(JSON.parse(readFileSync(path, 'utf8')))
  } catch (cause) {
    throw new FabricStateCorruptionError(path, cause)
  }
}

export function saveFabricState(path: string, state: unknown): FabricState {
  const validated = parseFabricState(state)
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(validated, null, 2), { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
  return validated
}
