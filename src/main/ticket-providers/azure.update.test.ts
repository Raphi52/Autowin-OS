import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../../shared/tickets'
import { azureTicketProvider } from './azure'

const updated = {
  id: 1227,
  fields: {
    'System.WorkItemType': 'Fiche Team',
    'System.Title': 'Ticket traité',
    'System.State': 'Clos',
    'System.ChangedDate': '2026-08-10T10:00:00.000Z'
  }
}

describe('adaptateur Azure — retour vers le work item', () => {
  it('met à jour les champs puis publie le compte-rendu', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(Response.json(updated))
      .mockResolvedValueOnce(Response.json({ id: 99, text: 'Tests verts.' }))

    const item = await azureTicketProvider.update!(
      {
        source: DEFAULT_TICKET_SOURCE,
        id: '1227',
        state: 'Clos',
        assignee: 'Alice',
        comment: 'Tests verts.'
      },
      { token: 'pat', fetchFn: fetchFn as typeof fetch }
    )

    expect(item.state).toBe('Clos')
    expect(fetchFn.mock.calls[0]?.[1]).toMatchObject({
      method: 'PATCH',
      headers: expect.objectContaining({ 'content-type': 'application/json-patch+json' })
    })
    expect(JSON.parse(String(fetchFn.mock.calls[0]?.[1]?.body))).toEqual([
      { op: 'add', path: '/fields/System.State', value: 'Clos' },
      { op: 'add', path: '/fields/System.AssignedTo', value: 'Alice' }
    ])
    expect(String(fetchFn.mock.calls[1]?.[0])).toContain('/workItems/1227/comments')
  })
})
