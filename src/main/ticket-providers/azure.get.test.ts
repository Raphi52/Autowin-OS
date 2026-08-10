import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../../shared/tickets'
import { azureTicketProvider } from './azure'
import { TicketProviderError, createTicketProviderRegistry } from './provider-contract'

/**
 * LIRE UNE FICHE PAR SON ID — le geste le plus élémentaire, et il manquait.
 *
 * Constaté en réel (2026-08-06) : à qui lui demandait la fiche 1227, l'agent a cherché la chaîne
 * « 1227 » dans les TITRES — seul outil dont il disposait — et n'a rien trouvé. C'était le
 * comportement correct de `ticket_search` (le titre du 1227 ne contient pas « 1227 »), appliqué à la
 * mauvaise question. Il a conclu « je ne trouve pas de WI 1227 » alors que la fiche existe.
 *
 * Chercher un IDENTIFIANT avec un outil de recherche TEXTUELLE ne peut pas marcher. Il fallait un
 * accès direct.
 */
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

const fiche1227 = {
  id: 1227,
  url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/workItems/1227',
  fields: {
    'System.WorkItemType': 'Fiche Team',
    'System.Title': "[REFUS FORMALITE] Mettre en place l'envoi mail automatique",
    'System.State': 'Ouvert',
    'System.ChangedDate': '2026-08-06T10:00:00.000Z'
  }
}

describe('adaptateur Azure — lecture par id', () => {
  it('rend la fiche demandée, normalisée', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({ value: [fiche1227] }))

    const item = await azureTicketProvider.get!(
      { source: DEFAULT_TICKET_SOURCE, id: '1227' },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )

    expect(item).toMatchObject({
      id: '1227',
      type: 'Fiche Team',
      title: "[REFUS FORMALITE] Mettre en place l'envoi mail automatique",
      state: 'Ouvert'
    })
    // L'id part dans l'URL : il doit être demandé au bon endpoint, sans requête WIQL inutile.
    expect(String(fetchFn.mock.calls[0]?.[0])).toContain('/_apis/wit/workitems?ids=1227')
  })

  it('REFUSE un id non numérique — il part dans l’URL', async () => {
    const fetchFn = vi.fn()
    for (const id of ['../../evil', '1227 OR 1=1', 'abc', '', '1.5', '-3']) {
      await expect(
        azureTicketProvider.get!(
          { source: DEFAULT_TICKET_SOURCE, id },
          { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
        )
      ).rejects.toThrow(TicketProviderError)
    }
    // Aucun appel réseau n'a été tenté avec un id douteux.
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('une fiche absente remonte une erreur de fournisseur, pas un objet vide', async () => {
    const fetchFn = vi.fn().mockResolvedValueOnce(json({ value: [] }))

    await expect(
      azureTicketProvider.get!(
        { source: DEFAULT_TICKET_SOURCE, id: '999999' },
        { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
      )
    ).rejects.toThrow(TicketProviderError)
  })

  it('enrichit la fiche avec les commentaires récents et les titres des work items liés', async () => {
    const linked = {
      id: 1300,
      fields: {
        'System.WorkItemType': 'Tache',
        'System.Title': 'Corriger le déploiement',
        'System.State': 'Ouvert',
        'System.ChangedDate': '2026-08-09T10:00:00.000Z'
      }
    }
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [
            {
              ...fiche1227,
              relations: [
                {
                  rel: 'System.LinkTypes.Dependency-Forward',
                  url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/workItems/1300'
                },
                {
                  rel: 'AttachedFile',
                  url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/attachments/a',
                  attributes: { name: 'preuve.png' }
                }
              ]
            }
          ]
        })
      )
      .mockResolvedValueOnce(json({ value: [linked] }))
      .mockResolvedValueOnce(
        json({
          comments: [
            {
              id: 9,
              text: '<p>La décision finale est ici.</p>',
              createdDate: '2026-08-10T09:00:00.000Z',
              createdBy: { displayName: 'Alice' }
            }
          ]
        })
      )

    const item = await azureTicketProvider.get!(
      { source: DEFAULT_TICKET_SOURCE, id: '1227' },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )

    expect(item.relations).toEqual([
      expect.objectContaining({ target: '1300', title: 'Corriger le déploiement' }),
      expect.objectContaining({ title: 'preuve.png' })
    ])
    expect(item.comments).toEqual([
      {
        id: '9',
        text: '<p>La décision finale est ici.</p>',
        createdAt: '2026-08-10T09:00:00.000Z',
        author: 'Alice'
      }
    ])
    expect(String(fetchFn.mock.calls[2]?.[0])).toContain('/workItems/1227/comments')
  })
})

describe('registre — la lecture par id est optionnelle côté adaptateur', () => {
  it('un fournisseur sans get() est REFUSÉ explicitement, jamais silencieusement', async () => {
    const registre = createTicketProviderRegistry([
      { provider: 'azure', list: async () => ({ items: [], hasMore: false }) }
    ])

    await expect(
      registre.get({ source: DEFAULT_TICKET_SOURCE, id: '1' }, { token: 'x' })
    ).rejects.toThrow(/non support/i)
  })

  it('délègue à l’adaptateur du fournisseur quand il sait lire', async () => {
    const get = vi.fn(async () => ({
      id: '1227',
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: 'Fiche Team',
      title: 'x',
      state: 'Ouvert',
      url: 'u',
      updatedAt: '2026-08-06T10:00:00.000Z',
      fields: {}
    }))
    const registre = createTicketProviderRegistry([
      { provider: 'azure', list: async () => ({ items: [], hasMore: false }), get }
    ])

    await registre.get({ source: DEFAULT_TICKET_SOURCE, id: '1227' }, { token: 'x' })
    expect(get).toHaveBeenCalled()
  })
})
