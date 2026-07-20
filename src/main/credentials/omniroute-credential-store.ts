import { Entry } from '@napi-rs/keyring'

const SERVICE = 'Autowin OS'
const ACCOUNT = 'OmniRoute Gateway'
const MAX_CREDENTIAL_LENGTH = 4096

export interface KeyringEntry {
  setPassword(value: string): void
  getPassword(): string | null
  deletePassword(): boolean
}

export interface OmniRouteCredentialStore {
  set(value: string): void
  get(): string | null
  delete(): boolean
}

export function createOmniRouteCredentialStore(
  entryFactory: () => KeyringEntry = () => new Entry(SERVICE, ACCOUNT)
): OmniRouteCredentialStore {
  const entry = entryFactory()
  return {
    set(value) {
      const normalized = value.trim()
      if (!normalized || normalized.length > MAX_CREDENTIAL_LENGTH) {
        throw new Error('Credential OmniRoute invalide')
      }
      entry.setPassword(normalized)
    },
    get() {
      return entry.getPassword()
    },
    delete() {
      return entry.deletePassword()
    }
  }
}
