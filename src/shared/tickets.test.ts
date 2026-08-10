import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TICKET_SOURCE,
  buildTicketListRequest,
  canonicalTicketId,
  ticketExecutionContext,
  ticketTargetRepository,
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
    expect(canonicalTicketId(items[0])).toBe('azure:AmitelGTC:RIG:RigApplication::17536')
  })
})

describe('#2 contexte d’exécution déclaré sur la source', () => {
  const item = { id: '42', title: 'Corriger le calcul de TVA' }

  it('accepte et normalise branchPrefix / commitConvention / verifyCommand', () => {
    expect(
      parseTicketSourceProfile({
        ...DEFAULT_TICKET_SOURCE,
        branchPrefix: '  fix  ',
        commitConvention: 'Conventional Commits',
        verifyCommand: 'npm test'
      })
    ).toEqual({
      ...DEFAULT_TICKET_SOURCE,
      branchPrefix: 'fix',
      commitConvention: 'Conventional Commits',
      verifyCommand: 'npm test'
    })
  })

  it('rejette un contexte d’exécution non textuel ou avec des caractères de contrôle', () => {
    expect(parseTicketSourceProfile({ ...DEFAULT_TICKET_SOURCE, branchPrefix: 42 })).toBeNull()
    expect(
      parseTicketSourceProfile({ ...DEFAULT_TICKET_SOURCE, verifyCommand: 'npm test\nrm -rf /' })
    ).toBeNull()
  })

  it('un champ vide est OMIS, jamais transmis vide', () => {
    expect(parseTicketSourceProfile({ ...DEFAULT_TICKET_SOURCE, branchPrefix: '   ' })).toEqual(
      DEFAULT_TICKET_SOURCE
    )
  })

  it('dépôt cible canonique par fournisseur', () => {
    expect(ticketTargetRepository(DEFAULT_TICKET_SOURCE)).toBe('RigApplication')
    expect(
      ticketTargetRepository({
        id: 'g',
        label: 'g',
        provider: 'github',
        owner: 'amitel',
        repository: 'os'
      })
    ).toBe('amitel/os')
    expect(
      ticketTargetRepository({
        id: 'l',
        label: 'l',
        provider: 'gitlab',
        namespace: 'grp',
        repository: 'proj'
      })
    ).toBe('grp/proj')
  })

  it('la branche N’EST proposée QUE si la source déclare un préfixe', () => {
    expect(ticketExecutionContext(DEFAULT_TICKET_SOURCE, item).branch).toBeUndefined()
    expect(
      ticketExecutionContext({ ...DEFAULT_TICKET_SOURCE, branchPrefix: 'fix/' }, item).branch
    ).toBe('fix/42-corriger-le-calcul-de-tva')
  })

  it('sans source déclarée : contexte VIDE (rien n’est inventé)', () => {
    expect(ticketExecutionContext(undefined, item)).toEqual({})
    expect(
      ticketExecutionContext(
        { id: 'a', label: 'a', provider: 'azure', organization: 'o', project: 'p' },
        item
      )
    ).toEqual({})
  })
})

describe('#6 recherche SERVEUR — buildTicketListRequest', () => {
  it('transmet titleContains au fournisseur', () => {
    expect(
      buildTicketListRequest({
        source: DEFAULT_TICKET_SOURCE,
        requestId: 'r1',
        pageSize: 50,
        titleContains: '  TVA  '
      })
    ).toEqual({
      source: DEFAULT_TICKET_SOURCE,
      requestId: 'r1',
      pageSize: 50,
      titleContains: 'TVA'
    })
  })

  it('recherche vide ou blanche = AUCUN filtre (et non « aucun résultat »)', () => {
    for (const value of ['', '   ', undefined]) {
      expect(
        buildTicketListRequest({ source: DEFAULT_TICKET_SOURCE, titleContains: value })
      ).not.toHaveProperty('titleContains')
    }
  })

  it('conserve le curseur de pagination avec le filtre courant', () => {
    expect(
      buildTicketListRequest({
        source: DEFAULT_TICKET_SOURCE,
        cursor: 'c1',
        titleContains: 'TVA'
      })
    ).toEqual({ source: DEFAULT_TICKET_SOURCE, cursor: 'c1', titleContains: 'TVA' })
  })
})

describe('#4 contrat enrichi du ticket', () => {
  it('porte les commentaires et le titre des relations', () => {
    const item: TicketItem = {
      id: '1',
      sourceId: 's',
      type: 'Bug',
      title: 'T',
      state: 'Ouvert',
      url: 'https://x/1',
      updatedAt: '2026-08-01T00:00:00.000Z',
      relations: [{ kind: 'parent', target: '2', title: 'Épopée' }],
      comments: [{ author: 'A', createdAt: '2026-08-01T00:00:00.000Z', text: 'ok' }],
      fields: {}
    }
    expect(item.comments?.[0].text).toBe('ok')
    expect(item.relations?.[0].title).toBe('Épopée')
  })
})
