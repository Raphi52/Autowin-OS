import { randomUUID } from 'node:crypto'
import { Entry } from '@napi-rs/keyring'
import { createOmniRouteCredentialStore, type KeyringEntry } from './omniroute-credential-store'

export interface OmniRouteKeyringSmokeResult {
  status: 'PASS'
  backend: 'windows-credential-manager'
  writeReadDelete: true
}

export function runOmniRouteKeyringSmoke(
  entryFactory: () => KeyringEntry = () =>
    new Entry('Autowin OS Test', `OmniRoute ${randomUUID()}`)
): OmniRouteKeyringSmokeResult {
  const secret = `autowin-smoke-${randomUUID()}`
  const store = createOmniRouteCredentialStore(entryFactory)
  try {
    store.set(secret)
    if (store.get() !== secret) throw new Error('Credential smoke read mismatch')
    if (!store.delete()) throw new Error('Credential smoke delete failed')
    if (store.get() !== null) throw new Error('Credential smoke residue detected')
    return {
      status: 'PASS',
      backend: 'windows-credential-manager',
      writeReadDelete: true
    }
  } finally {
    try {
      store.delete()
    } catch {
      // Best effort only after the primary smoke result has already failed.
    }
  }
}
