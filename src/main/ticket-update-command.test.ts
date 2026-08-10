import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../shared/tickets'
import { updateTicketFromCommand } from './ticket-update-command'

describe('commande agent ticket_update', () => {
  it('résout la source autorisée et transmet commentaire + état', async () => {
    const update = vi.fn(async (request) => ({
      id: request.id,
      sourceId: request.source.id,
      type: 'Fiche Team',
      title: 'Ticket traité',
      state: request.state ?? 'Ouvert',
      url: 'https://example.test/1',
      updatedAt: '2026-08-10T10:00:00.000Z',
      fields: {}
    }))

    const result = await updateTicketFromCommand(
      { id: '#1227', sourceId: DEFAULT_TICKET_SOURCE.id, comment: 'Tests verts.', state: 'Clos' },
      { listSources: () => [DEFAULT_TICKET_SOURCE], update }
    )

    expect(result.ok).toBe(true)
    expect(update).toHaveBeenCalledWith({
      source: DEFAULT_TICKET_SOURCE,
      id: '1227',
      comment: 'Tests verts.',
      state: 'Clos'
    })
  })

  it('refuse une cible ambiguë et une mise à jour vide', async () => {
    const update = vi.fn()
    await expect(
      updateTicketFromCommand(
        { id: '1227', comment: 'x' },
        {
          listSources: () => [
            DEFAULT_TICKET_SOURCE,
            { ...DEFAULT_TICKET_SOURCE, id: 'azure:other', project: 'Other' }
          ],
          update
        }
      )
    ).resolves.toMatchObject({ ok: false })
    await expect(
      updateTicketFromCommand(
        { id: '1227' },
        { listSources: () => [DEFAULT_TICKET_SOURCE], update }
      )
    ).resolves.toMatchObject({ ok: false })
    expect(update).not.toHaveBeenCalled()
  })
})
