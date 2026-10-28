import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem } from '../shared/tickets'
import { azureTicketProvider } from './ticket-providers/azure'
import { normalizeTicketItem } from './tickets-service'
import { getTicketFromCommand } from './ticket-get-command'
import { formatTicketTreatmentPrompt } from '../renderer/src/components/ticket-treatment'

/**
 * PLAFOND MUET n°1 (conv-1228, 2026-10-28 : « cherche d'autres plafonds a la con comme ca ») : la
 * discussion d'une fiche était coupée à TROIS endroits sans que personne le sache —
 *  - Azure : `$top=20`, seuls 20 commentaires étaient demandés, sans suivre la page suivante ;
 *  - la frontière (`normalizeTicketItem`) : 20 commentaires, 2 000 caractères chacun, sans marque ;
 *  - `ticket_get` : AUCUN commentaire rendu à l'agent (`toDetail` ne les recopiait pas).
 * L'agent lisait une fiche amputée de sa discussion — souvent l'information décisive — sans le savoir.
 */
function json(value: unknown): Response {
  return Response.json(value, { status: 200 })
}

const item = (over: Partial<TicketItem> = {}): TicketItem => ({
  id: '1227',
  sourceId: DEFAULT_TICKET_SOURCE.id,
  type: 'Bug',
  title: 'T',
  state: 'Ouvert',
  url: 'https://x/1227',
  updatedAt: '2026-08-01T00:00:00.000Z',
  fields: {},
  ...over
})

describe('la discussion d’une fiche arrive entière', () => {
  it('Azure : suit les pages de commentaires, du plus ancien au plus récent', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        json({
          value: [
            {
              id: 1227,
              url: 'https://dev.azure.com/org/projet/_apis/wit/workItems/1227',
              fields: {
                'System.WorkItemType': 'Bug',
                'System.Title': 'T',
                'System.State': 'Ouvert',
                'System.ChangedDate': '2026-08-06T10:00:00.000Z'
              }
            }
          ]
        })
      )
      .mockResolvedValueOnce(
        json({ comments: [{ id: 1, text: 'premier' }], continuationToken: 'page-2' })
      )
      .mockResolvedValueOnce(json({ comments: [{ id: 2, text: 'second' }] }))

    const fiche = await azureTicketProvider.get!(
      { source: DEFAULT_TICKET_SOURCE, id: '1227' },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )

    expect(fiche.comments?.map((c) => c.text)).toEqual(['premier', 'second'])
    const premiereUrl = String(fetchFn.mock.calls[1]?.[0])
    expect(premiereUrl).toContain('order=asc')
    expect(String(fetchFn.mock.calls[2]?.[0])).toContain('continuationToken=page-2')
  })

  it('la frontière garde TOUS les commentaires et leur texte entier', () => {
    const comments = Array.from({ length: 40 }, (_, index) => ({
      author: 'A',
      text: `m${index} ${'x'.repeat(5_000)}`
    }))
    const normalise = normalizeTicketItem(item({ comments }))
    expect(normalise.comments).toHaveLength(40)
    expect(normalise.comments?.[0].text).toBe(comments[0].text)
  })

  it('un commentaire démesuré (image collée) est borné EN LE DISANT', () => {
    const enorme = `debut ${'x'.repeat(60_000)}`
    const normalise = normalizeTicketItem(item({ comments: [{ text: enorme }] }))
    const texte = normalise.comments?.[0].text ?? ''
    expect(texte.startsWith('debut ')).toBe(true)
    expect(texte.length).toBeLessThan(enorme.length)
    expect(texte).toMatch(/caractères coupés/)
  })

  it('ticket_get rend la discussion à l’agent', async () => {
    const issue = await getTicketFromCommand(
      { id: '1227' },
      {
        listSources: () => [DEFAULT_TICKET_SOURCE],
        get: async () =>
          item({ comments: [{ author: 'Alice', text: 'La décision finale est ici.' }] })
      }
    )
    expect(issue.ok).toBe(true)
    if (issue.ok) {
      expect(issue.ticket.comments).toEqual([
        { author: 'Alice', text: 'La décision finale est ici.' }
      ])
    }
  })

  it('le prompt de traitement dit quand la discussion est résumée, et où la lire entière', () => {
    const comments = Array.from({ length: 15 }, (_, index) => ({
      author: 'A',
      text: `message ${index}`
    }))
    const prompt = formatTicketTreatmentPrompt(item({ comments }))
    expect(prompt).toMatch(/ticket_get/)
    expect(prompt).toMatch(/10 commentaires sur 15/)
  })

  it('aucun renvoi quand la discussion tient entière dans le prompt', () => {
    const prompt = formatTicketTreatmentPrompt(item({ comments: [{ text: 'court' }] }))
    expect(prompt).not.toMatch(/commentaires sur/)
  })
})
