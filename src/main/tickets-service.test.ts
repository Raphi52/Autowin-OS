import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem, type TicketSourceProfile } from '../shared/tickets'
import type { TicketCredentialStore } from './ticket-credential-store'
import type { TicketProviderRegistry } from './ticket-providers/provider-contract'
import type { TicketSourceStore } from './ticket-source-store'
import { TicketService, normalizeTicketItem, ticketCredentialKey } from './tickets-service'

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

describe('#4 enrichissement borné à la frontière (discussion + titre des relations)', () => {
  const item = (over: Partial<TicketItem> = {}): TicketItem => ({
    id: '1',
    sourceId: DEFAULT_TICKET_SOURCE.id,
    type: 'Bug',
    title: 'T',
    state: 'Ouvert',
    url: 'https://x/1',
    updatedAt: '2026-08-01T00:00:00.000Z',
    fields: {},
    ...over
  })

  it('garde les commentaires les plus RÉCENTS et borne leur taille', () => {
    const comments = Array.from({ length: 40 }, (_, index) => ({
      author: 'A',
      text: `m${index} ${'x'.repeat(5_000)}`
    }))
    const normalized = normalizeTicketItem(item({ comments }))
    expect(normalized.comments).toHaveLength(20)
    expect(normalized.comments?.[0].text.startsWith('m20')).toBe(true)
    expect(normalized.comments?.[0].text.length).toBeLessThanOrEqual(2_000)
  })

  it('ignore un commentaire vide et n’invente aucun titre de relation', () => {
    const normalized = normalizeTicketItem(
      item({
        comments: [{ text: '   ' }, { text: 'utile' }],
        relations: [{ kind: 'parent', target: '2' }, { kind: 'related', target: '3', title: ' É ' }]
      })
    )
    expect(normalized.comments).toEqual([{ text: 'utile' }])
    expect(normalized.relations?.[0]).not.toHaveProperty('title')
    expect(normalized.relations?.[1].title).toBe('É')
  })

  it('une fiche sans enrichissement traverse inchangée', () => {
    const plain = item()
    expect(normalizeTicketItem(plain)).toEqual(plain)
  })

  it('list() normalise les fiches remontées par l’adaptateur', async () => {
    const deps = fixture()
    const registry = {
      supports: vi.fn(() => true),
      list: vi.fn(async () => ({
        items: [item({ comments: Array.from({ length: 30 }, () => ({ text: 'c' })) })],
        hasMore: false
      }))
    } as unknown as TicketProviderRegistry
    const service = new TicketService({ ...deps, registry })
    const page = await service.list({ source: DEFAULT_TICKET_SOURCE })
    expect(page.items[0].comments).toHaveLength(20)
  })
})
