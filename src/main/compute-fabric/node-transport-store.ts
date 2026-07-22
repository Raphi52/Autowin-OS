import { Entry } from '@napi-rs/keyring'

const SERVICE = 'Autowin OS'
const ACCOUNT_PREFIX = 'Compute Fabric Node '
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
const SHA256 = /^[a-f0-9]{64}$/
const MAX_ORIGIN_LENGTH = 2048
const MAX_BEARER_LENGTH = 4096

export interface KeyringEntry {
  setPassword(value: string): void
  getPassword(): string | null
  deletePassword(): boolean
}

export interface FabricNodeTransport {
  origin: string
  tlsSpkiSha256: string
  bearerToken?: string
}

export interface FabricNodeTransportStore {
  set(value: FabricNodeTransport): void
  get(): FabricNodeTransport | null
  delete(): boolean
}

export class FabricNodeTransportCorruptionError extends Error {
  readonly code = 'FABRIC_TRANSPORT_CORRUPT' as const
  readonly nodeId: string

  constructor(nodeId: string, cause: unknown) {
    super(`Transport Compute Fabric corrompu ou invalide: ${nodeId}`, { cause })
    this.name = 'FabricNodeTransportCorruptionError'
    this.nodeId = nodeId
  }
}

function normalizeOrigin(value: unknown): string {
  if (typeof value !== 'string' || !value || value.length > MAX_ORIGIN_LENGTH) {
    throw new Error('Origine du Node invalide')
  }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error('Origine du Node invalide')
  }
  if (
    url.protocol !== 'https:' ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  ) {
    throw new Error('Origine du Node invalide')
  }
  return url.origin
}

function normalizeBearer(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new Error('Bearer du Node invalide')
  const normalized = value.trim()
  if (
    !normalized ||
    normalized.length > MAX_BEARER_LENGTH ||
    [...normalized].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new Error('Bearer du Node invalide')
  }
  return normalized
}

function normalizeTlsSpkiSha256(value: unknown): string {
  if (typeof value !== 'string' || !SHA256.test(value)) {
    throw new Error('Pin TLS/SPKI du Node invalide')
  }
  return value
}

export function parseFabricNodeTransport(value: unknown): FabricNodeTransport {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Transport du Node invalide')
  }
  const raw = value as Record<string, unknown>
  const unknown = Object.keys(raw).find(
    (key) => key !== 'origin' && key !== 'tlsSpkiSha256' && key !== 'bearerToken'
  )
  if (unknown) throw new Error(`Champ de transport Node inconnu: ${unknown}`)
  const bearerToken = normalizeBearer(raw.bearerToken)
  return {
    origin: normalizeOrigin(raw.origin),
    tlsSpkiSha256: normalizeTlsSpkiSha256(raw.tlsSpkiSha256),
    ...(bearerToken ? { bearerToken } : {})
  }
}

export function createFabricNodeTransportStore(
  nodeId: string,
  entryFactory: () => KeyringEntry = () => new Entry(SERVICE, `${ACCOUNT_PREFIX}${nodeId}`)
): FabricNodeTransportStore {
  if (!IDENTIFIER.test(nodeId)) throw new Error('Identité du Node invalide')
  const entry = entryFactory()
  return {
    set(value) {
      entry.setPassword(JSON.stringify(parseFabricNodeTransport(value)))
    },
    get() {
      const stored = entry.getPassword()
      if (!stored) return null
      try {
        return parseFabricNodeTransport(JSON.parse(stored))
      } catch (cause) {
        throw new FabricNodeTransportCorruptionError(nodeId, cause)
      }
    },
    delete() {
      return entry.deletePassword()
    }
  }
}
