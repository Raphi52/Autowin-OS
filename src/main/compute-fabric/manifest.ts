import { createHash, createPublicKey, verify as verifySignature } from 'node:crypto'
import {
  parseNodeManifest,
  type ComputeResource,
  type NodeManifest
} from '../../shared/compute-fabric'

function assertWellFormedString(value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    const unit = value.charCodeAt(index)
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (next < 0xdc00 || next > 0xdfff) throw new Error('Chaîne Unicode non canonique')
      index += 1
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new Error('Chaîne Unicode non canonique')
    }
  }
}

function canonicalize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (typeof value === 'string') {
    assertWellFormedString(value)
    return JSON.stringify(value)
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Nombre JSON non canonique')
    return JSON.stringify(value)
  }
  if (typeof value !== 'object') throw new Error('Valeur hors contrat JSON canonique')
  if (ancestors.has(value)) throw new Error('Cycle interdit dans le JSON canonique')

  ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      return `[${value.map((entry) => canonicalize(entry, ancestors)).join(',')}]`
    }
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) {
      throw new Error('Objet hors contrat JSON canonique')
    }
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0
    )
    return `{${entries
      .map(([key, entry]) => {
        assertWellFormedString(key)
        return `${JSON.stringify(key)}:${canonicalize(entry, ancestors)}`
      })
      .join(',')}}`
  } finally {
    ancestors.delete(value)
  }
}

/**
 * Autowin canonical JSON v1: JSON-only values, finite numbers, well-formed Unicode,
 * object keys ordered by UTF-16 code units, and no omitted/implicit values.
 */
export function canonicalJson(value: unknown): string {
  return canonicalize(value, new Set())
}

export interface TrustedNodeIdentity {
  nodeId: string
  keyId: string
  signingPublicKeyFingerprint: string
  signingPublicKeyPem: string
}

export interface ManifestVerificationOptions {
  now: Date
  lastSequence?: number
  maxClockSkewMs?: number
  maxManifestLifetimeMs?: number
}

export interface VerifiedNodeManifest {
  manifest: NodeManifest
  manifestDigest: string
  resources: ComputeResource[]
}

function signedManifestBody(manifest: NodeManifest): Omit<NodeManifest, 'signature'> {
  return {
    schema: manifest.schema,
    protocol: manifest.protocol,
    node: manifest.node,
    sequence: manifest.sequence,
    issuedAt: manifest.issuedAt,
    expiresAt: manifest.expiresAt,
    adapters: manifest.adapters,
    resources: manifest.resources
  }
}

function decodeEd25519Signature(value: string): Buffer {
  const decoded = Buffer.from(value, 'base64')
  if (decoded.length !== 64 || decoded.toString('base64') !== value) {
    throw new Error('Signature Ed25519 mal formée')
  }
  return decoded
}

export function verifyNodeManifest(
  input: unknown,
  trust: TrustedNodeIdentity,
  options: ManifestVerificationOptions
): VerifiedNodeManifest {
  const manifest = parseNodeManifest(input)
  if (manifest.node.id !== trust.nodeId) throw new Error('Identité Node inattendue')
  if (
    manifest.node.keyId !== trust.keyId ||
    manifest.signature.keyId !== trust.keyId ||
    manifest.signature.keyId !== manifest.node.keyId
  ) {
    throw new Error('keyId du manifeste non appairé')
  }

  const publicKey = createPublicKey(trust.signingPublicKeyPem)
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('Clé Node non Ed25519')
  const publicDer = publicKey.export({ format: 'der', type: 'spki' })
  const actualFingerprint = createHash('sha256').update(publicDer).digest('hex')
  if (
    actualFingerprint !== trust.signingPublicKeyFingerprint ||
    manifest.node.signingPublicKeyFingerprint !== trust.signingPublicKeyFingerprint
  ) {
    throw new Error('Fingerprint de clé Node inattendu')
  }

  const issuedAt = Date.parse(manifest.issuedAt)
  const expiresAt = Date.parse(manifest.expiresAt)
  const now = options.now.getTime()
  const maxClockSkewMs = options.maxClockSkewMs ?? 30_000
  const maxManifestLifetimeMs = options.maxManifestLifetimeMs ?? 10 * 60_000
  if (!Number.isFinite(issuedAt) || !Number.isFinite(expiresAt)) {
    throw new Error('Horodatage de manifeste invalide')
  }
  if (
    issuedAt > now + maxClockSkewMs ||
    expiresAt <= now ||
    expiresAt <= issuedAt ||
    expiresAt - issuedAt > maxManifestLifetimeMs
  ) {
    throw new Error('Fenêtre temporelle du manifeste invalide ou expirée')
  }
  if (options.lastSequence !== undefined && manifest.sequence <= options.lastSequence) {
    throw new Error('Séquence de manifeste rejouée ou en rollback')
  }

  const canonicalBody = Buffer.from(canonicalJson(signedManifestBody(manifest)))
  if (
    !verifySignature(
      null,
      canonicalBody,
      publicKey,
      decodeEd25519Signature(manifest.signature.value)
    )
  ) {
    throw new Error('Signature du manifeste invalide')
  }

  return {
    manifest,
    manifestDigest: createHash('sha256').update(canonicalBody).digest('hex'),
    resources: manifest.resources.map((resource) => ({ ...resource, nodeId: manifest.node.id }))
  }
}
