import { Entry } from '@napi-rs/keyring'

const SERVICE = 'Autowin OS'
const ACCOUNT_PREFIX = 'Tickets '
const SOURCE_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/
const MAX_CREDENTIAL_LENGTH = 4096

export interface TicketKeyringEntry {
  setPassword(value: string): void
  getPassword(): string | null
  deletePassword(): boolean
}

export interface TicketCredentialStore {
  set(sourceId: string, credential: string): void
  get(sourceId: string): string | null
  has(sourceId: string): boolean
  delete(sourceId: string): boolean
}

function parseSourceId(sourceId: unknown): string {
  if (
    typeof sourceId !== 'string' ||
    !SOURCE_ID.test(sourceId) ||
    sourceId.includes('..') ||
    sourceId.includes('//')
  ) {
    throw new Error('Identité de source Tickets invalide')
  }
  return sourceId
}

export function parseTicketCredential(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_CREDENTIAL_LENGTH ||
    value.trim() !== value ||
    [...value].some((character) => (character.codePointAt(0) ?? 0) < 32)
  ) {
    throw new Error('Credential Tickets invalide')
  }
  return value
}

export function createTicketCredentialStore(
  entryFactory: (account: string) => TicketKeyringEntry = (account) =>
    new Entry(SERVICE, account)
): TicketCredentialStore {
  const entries = new Map<string, TicketKeyringEntry>()
  const entryFor = (sourceId: string): TicketKeyringEntry => {
    const normalized = parseSourceId(sourceId)
    let entry = entries.get(normalized)
    if (!entry) {
      entry = entryFactory(`${ACCOUNT_PREFIX}${normalized}`)
      entries.set(normalized, entry)
    }
    return entry
  }
  return {
    set(sourceId, credential) {
      entryFor(sourceId).setPassword(parseTicketCredential(credential))
    },
    get(sourceId) {
      return entryFor(sourceId).getPassword()
    },
    has(sourceId) {
      return entryFor(sourceId).getPassword() !== null
    },
    delete(sourceId) {
      return entryFor(sourceId).deletePassword()
    }
  }
}
