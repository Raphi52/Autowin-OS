import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../../shared/tickets'
import { TicketProviderError } from './provider-contract'
import { azureTicketProvider } from './azure'

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

describe('adaptateur Azure DevOps Tickets', () => {
  it('parcourt tous les types et états avec une requête WIQL ordonnée et un curseur', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          workItems: [{ id: 11 }, { id: 12 }, { id: 13 }]
        })
      )
      .mockResolvedValueOnce(
        json({
          value: [
            {
              id: 11,
              url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/workItems/11',
              fields: {
                'System.WorkItemType': 'Fiche Team',
                'System.Title': 'Première fiche',
                'System.State': 'En cours',
                'System.ChangedDate': '2026-07-23T10:00:00.000Z'
              }
            },
            {
              id: 12,
              url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/workItems/12',
              fields: {
                'System.WorkItemType': 'Bug',
                'System.Title': 'Un bug fermé',
                'System.State': 'Closed',
                'System.ChangedDate': '2026-07-23T11:00:00.000Z'
              }
            }
          ]
        })
      )

    const page = await azureTicketProvider.list(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 2 },
      { token: 'pat-secret', fetchFn: fetchFn as typeof fetch }
    )

    const [wiqlUrl, wiqlInit] = fetchFn.mock.calls[0]
    expect(wiqlUrl).toBe(
      'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/wiql?$top=3&api-version=7.1'
    )
    expect(wiqlInit).toEqual(
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          authorization: `Basic ${Buffer.from(':pat-secret').toString('base64')}`
        })
      })
    )
    const wiqlBody = JSON.parse(String(wiqlInit?.body)) as { query: string }
    expect(wiqlBody.query).toContain('[System.TeamProject] = @project')
    expect(wiqlBody.query).toContain('ORDER BY [System.Id] ASC')
    expect(wiqlBody.query).not.toMatch(/WorkItemType|System\.State/)
    expect(page.items.map(({ type, state }) => [type, state])).toEqual([
      ['Fiche Team', 'En cours'],
      ['Bug', 'Closed']
    ])
    expect(page).toMatchObject({ cursor: '12', hasMore: true })

    const nextFetch = vi
      .fn()
      .mockResolvedValueOnce(json({ workItems: [{ id: 13 }] }))
      .mockResolvedValueOnce(
        json({
          value: [
            {
              id: 13,
              fields: {
                'System.WorkItemType': 'Tache',
                'System.Title': 'Suite',
                'System.State': 'A faire',
                'System.ChangedDate': '2026-07-23T12:00:00.000Z'
              }
            }
          ]
        })
      )

    const nextPage = await azureTicketProvider.list(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 2, cursor: page.cursor },
      { token: 'pat-secret', fetchFn: nextFetch as typeof fetch }
    )
    const nextBody = JSON.parse(String(nextFetch.mock.calls[0][1]?.body)) as { query: string }
    expect(nextBody.query).toContain('[System.Id] > 12')
    expect(nextPage).toMatchObject({ cursor: undefined, hasMore: false })
  })

  it('charge les détails par lots de 200 maximum et normalise champs et relations', async () => {
    const references = Array.from({ length: 202 }, (_, index) => ({ id: index + 1 }))
    const item = (id: number) => ({
      id,
      fields: {
        'System.WorkItemType': 'Type personnalisé',
        'System.Title': `Élément ${id}`,
        'System.State': 'État personnalisé',
        'System.ChangedDate': '2026-07-23T10:00:00.000Z',
        'System.CreatedDate': '2026-07-22T10:00:00.000Z',
        'System.AssignedTo': { displayName: 'Ada Lovelace' },
        'Microsoft.VSTS.Common.Priority': 2,
        'System.Description': '<p>Détail</p>',
        'Custom.Inconnu': 'conservé'
      },
      relations: [
        {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/workItems/42',
          attributes: { name: 'Parent' }
        }
      ]
    })
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(json({ workItems: references }))
      .mockResolvedValueOnce(json({ value: references.slice(0, 200).map(({ id }) => item(id)) }))
      .mockResolvedValueOnce(json({ value: references.slice(200).map(({ id }) => item(id)) }))

    const page = await azureTicketProvider.list(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 202 },
      { token: 'pat-secret', fetchFn: fetchFn as typeof fetch }
    )

    const detailCalls = fetchFn.mock.calls.slice(1)
    expect(detailCalls).toHaveLength(2)
    expect(new URL(String(detailCalls[0][0])).searchParams.get('ids')?.split(',')).toHaveLength(200)
    expect(new URL(String(detailCalls[1][0])).searchParams.get('ids')?.split(',')).toHaveLength(2)
    for (const [url, init] of detailCalls) {
      expect(init).toEqual(expect.objectContaining({ method: 'GET' }))
      expect(new URL(String(url)).searchParams.get('$expand')).toBe('Relations')
    }
    expect(page.items[0]).toMatchObject({
      id: '1',
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: 'Type personnalisé',
      title: 'Élément 1',
      state: 'État personnalisé',
      url: 'https://dev.azure.com/AmitelGTC/RIG/_workitems/edit/1',
      updatedAt: '2026-07-23T10:00:00.000Z',
      createdAt: '2026-07-22T10:00:00.000Z',
      assignee: 'Ada Lovelace',
      priority: 2,
      description: '<p>Détail</p>',
      fields: expect.objectContaining({ 'Custom.Inconnu': 'conservé' }),
      relations: [
        {
          kind: 'System.LinkTypes.Hierarchy-Reverse',
          target: '42',
          url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/workItems/42'
        }
      ]
    })
  })

  it('classe une forme de réponse Azure invalide via le contrat fournisseur', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({ workItems: 'incorrect' }))

    await expect(
      azureTicketProvider.list(
        { source: DEFAULT_TICKET_SOURCE },
        { token: 'pat-secret', fetchFn: fetchFn as typeof fetch }
      )
    ).rejects.toEqual(new TicketProviderError('INVALID_RESPONSE', 'Réponse Azure DevOps invalide.'))
  })
})
