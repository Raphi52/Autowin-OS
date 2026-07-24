import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketSourceProfile } from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'
import { TicketService, ticketCredentialKey } from './tickets-service'

function fixture() {
  const profiles: TicketSourceProfile[] = [DEFAULT_TICKET_SOURCE]
  const sourceStore = {
    list: vi.fn(() => profiles),
    save: vi.fn(),
    remove: vi.fn()
  } as unknown as TicketSourceStore
  const credentialStore = {
    get: vi.fn(() => null),
    has: vi.fn(() => false),
    delete: vi.fn()
  } as unknown as TicketCredentialStore
  const registry = {
    supports: vi.fn(() => true),
    list: vi.fn(async () => ({ items: [], hasMore: false }))
  } as unknown as TicketProviderRegistry
  return { sourceStore, credentialStore, registry }
}

describe('service Tickets côté main', () => {
  it('ne renvoie que les profils et un booléen de credential', () => {
    const deps = fixture()
    const service = new TicketService(deps)

    expect(service.sources()).toEqual([
      { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }
    ])
    expect(JSON.stringify(service.sources())).not.toContain('token')
  })

  it('utilise le fallback Azure CLI sans exposer le credential', async () => {
    const deps = fixture()
    const tokenFallback = vi.fn(async () => ({
      token: 'azure-cli-secret',
      authScheme: 'bearer' as const
    }))
    const service = new TicketService({ ...deps, tokenFallback })

    await service.list({ source: DEFAULT_TICKET_SOURCE, pageSize: 50 })

    expect(tokenFallback).toHaveBeenCalledWith(DEFAULT_TICKET_SOURCE)
    expect(deps.registry.list).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 50 },
      { token: 'azure-cli-secret', authScheme: 'bearer' }
    )
  })

  it('ignore tout credential Azure stocké et utilise exclusivement Azure CLI', async () => {
    const deps = fixture()
    vi.mocked(deps.credentialStore.get).mockReturnValue('legacy-pat')
    vi.mocked(deps.credentialStore.has).mockReturnValue(true)
    const tokenFallback = vi.fn(async () => ({
      token: 'azure-cli-secret',
      authScheme: 'bearer' as const
    }))
    const service = new TicketService({ ...deps, tokenFallback })

    expect(service.sources()).toEqual([
      { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }
    ])
    await service.list({ source: DEFAULT_TICKET_SOURCE })

    expect(deps.credentialStore.get).not.toHaveBeenCalled()
    expect(tokenFallback).toHaveBeenCalledWith(DEFAULT_TICKET_SOURCE)
    expect(deps.registry.list).toHaveBeenCalledWith(
      { source: DEFAULT_TICKET_SOURCE },
      { token: 'azure-cli-secret', authScheme: 'bearer' }
    )
  })

  it('refuse un profil forgé par le renderer même si son id existe', async () => {
    const deps = fixture()
    const service = new TicketService(deps)

    await expect(
      service.list({
        source: { ...DEFAULT_TICKET_SOURCE, organization: 'attacker' }
      })
    ).rejects.toThrow(/profil.*autorisé/i)
  })

  it('borne la pagination reçue via IPC', async () => {
    const deps = fixture()
    const service = new TicketService(deps)
    await expect(service.list({ source: DEFAULT_TICKET_SOURCE, pageSize: 1000 })).rejects.toThrow(
      /taille.*invalide/i
    )
    await expect(
      service.list({ source: DEFAULT_TICKET_SOURCE, cursor: 'x'.repeat(2001) })
    ).rejects.toThrow(/curseur.*invalide/i)
  })

  it('ne réutilise pas un ancien credential indexé seulement par id sur un autre origin', async () => {
    const deps = fixture()
    const customSource: TicketSourceProfile = {
      id: 'github:private:repo',
      label: 'private / repo',
      provider: 'github',
      owner: 'private',
      repository: 'repo',
      apiBaseUrl: 'https://attacker.example/api/v3'
    }
    vi.mocked(deps.sourceStore.list).mockReturnValue([customSource])
    vi.mocked(deps.credentialStore.get).mockImplementation((key) =>
      key === customSource.id ? 'credential-for-another-origin' : null
    )
    const service = new TicketService(deps)

    await service.list({ source: customSource })

    expect(deps.registry.list).toHaveBeenCalledWith(
      { source: customSource },
      { token: '', authScheme: 'bearer' }
    )
  })

  it('indexe le coffre par identité et origin, puis retire l’ancienne liaison au remplacement', () => {
    const deps = fixture()
    const original: TicketSourceProfile = {
      id: 'github:private:repo',
      label: 'private / repo',
      provider: 'github',
      owner: 'private',
      repository: 'repo'
    }
    const replacement: TicketSourceProfile = {
      ...original,
      apiBaseUrl: 'https://github.corp.example/api/v3'
    }
    vi.mocked(deps.sourceStore.list).mockReturnValue([original])
    const service = new TicketService(deps)

    service.saveSource(replacement)

    expect(ticketCredentialKey(original)).not.toBe(ticketCredentialKey(replacement))
    expect(deps.credentialStore.delete).toHaveBeenCalledWith(ticketCredentialKey(original))
    expect(deps.sourceStore.save).toHaveBeenCalledWith(replacement)
  })
})
