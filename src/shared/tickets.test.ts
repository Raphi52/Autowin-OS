import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICKET_SOURCE,
  canonicalTicketId,
  parseTicketSourceProfile,
  type TicketItem,
  type TicketPage
} from './tickets'

describe('contrat partag? Tickets', () => {
  it('initialise RigApplication sur tous les Work Items du projet RIG', () => {
    expect(DEFAULT_TICKET_SOURCE).toEqual({
      id: 'azure:AmitelGTC:RIG:RigApplication',
      label: 'AmitelGTC / RIG / RigApplication',
      provider: 'azure',
      organization: 'AmitelGTC',
      project: 'RIG',
      repository: 'RigApplication'
    })
  })

  it.each([
    [
      {
        id: 'azure:AmitelGTC:RIG:RigApplication',
        label: 'RigApplication',
        provider: 'azure',
        organization: 'AmitelGTC',
        project: 'RIG',
        repository: 'RigApplication'
      }
    ],
    [
      {
        id: 'github:openai:codex',
        label: 'openai/codex',
        provider: 'github',
        owner: 'openai',
        repository: 'codex'
      }
    ],
    [
      {
        id: 'gitlab:group/subgroup:project',
        label: 'group/subgroup/project',
        provider: 'gitlab',
        namespace: 'group/subgroup',
        repository: 'project',
        baseUrl: 'https://gitlab.example.test'
      }
    ]
  ])('accepte un profil fournisseur strict et non secret', (profile) => {
    expect(parseTicketSourceProfile(profile)).toEqual(profile)
  })

  it('rejette les profils incomplets, inconnus ou contenant un secret', () => {
    expect(parseTicketSourceProfile({ provider: 'azure', project: 'RIG' })).toBeNull()
    expect(parseTicketSourceProfile({ provider: 'bitbucket', repository: 'repo' })).toBeNull()
    expect(
      parseTicketSourceProfile({
        id: 'github:o:r',
        label: 'o/r',
        provider: 'github',
        owner: 'o',
        repository: 'r',
        token: 'secret'
      })
    ).toBeNull()
  })

  it('rejette les m?tacaract?res de shell dans les h?tes de forge', () => {
    for (const hostname of ['foo&ver', 'foo&&whoami', 'foo%PATH%', 'foo|whoami', 'foo^bar']) {
      expect(
        parseTicketSourceProfile({
          id: `github:${hostname}`,
          label: hostname,
          provider: 'github',
          owner: 'owner',
          repository: 'repo',
          apiBaseUrl: `https://${hostname}`
        })
      ).toBeNull()
    }
  })

  it('conserve les types et ?tats distants sans allowlist', () => {
    const items: TicketItem[] = [
      {
        id: '17536',
        sourceId: DEFAULT_TICKET_SOURCE.id,
        type: 'Fiche Team',
        title: 'Une fiche',
        state: 'En cours',
        url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/17536',
        updatedAt: '2026-07-23T10:00:00.000Z',
        fields: {}
      },
      {
        id: '17537',
        sourceId: DEFAULT_TICKET_SOURCE.id,
        type: 'Tache',
        title: 'Une t?che',
        state: 'A faire',
        url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/17537',
        updatedAt: '2026-07-23T10:00:00.000Z',
        fields: {}
      },
      {
        id: '17538',
        sourceId: DEFAULT_TICKET_SOURCE.id,
        type: 'Bug',
        title: 'Un autre type',
        state: 'Closed',
        url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/17538',
        updatedAt: '2026-07-23T10:00:00.000Z',
        fields: {}
      }
    ]
    const page: TicketPage = { items, cursor: 'next-page', hasMore: true }

    expect(page.items.map(({ type, state }) => [type, state])).toEqual([
      ['Fiche Team', 'En cours'],
      ['Tache', 'A faire'],
      ['Bug', 'Closed']
    ])
    expect(canonicalTicketId(items[0])).toBe(
      'azure:AmitelGTC:RIG:RigApplication::17536'
    )
  })
})
