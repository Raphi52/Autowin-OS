// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem, type TicketPage } from '../../../shared/tickets'
import type { StockVeille } from '../../../main/veille/candidats-store'
import { TicketsView } from './TicketsView'
import { appliquerLangue } from '../langue'

/**
 * L'ÉCRAN TICKETS SUIT LA LANGUE (traduction anglaise, conv-1170, lot « Tickets »). Entrée qui doit
 * faire échouer ce test : un libellé de TicketsView ou de la section des candidats de veille
 * (VeilleCandidatsSection) laissé en dur, ou un écran qui ne se redessine pas quand la langue change.
 */
beforeAll(() => {
  ;(globalThis as never as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true
})

const fiche = (id: string): TicketItem => ({
  id,
  sourceId: DEFAULT_TICKET_SOURCE.id,
  type: 'Bug',
  title: `Ticket ${id}`,
  state: 'Active',
  description: '',
  createdAt: '2026-07-22T09:00:00.000Z',
  updatedAt: '2026-07-23T10:00:00.000Z',
  url: `https://example.test/tickets/${id}`,
  relations: [],
  fields: {}
})

const stockVeille: StockVeille = {
  candidats: [
    {
      id: 'codex|https://x.test/releases|support mcp',
      concurrent: 'Codex',
      titre: 'Support MCP distant',
      url: 'https://x.test/releases',
      dateSource: '2026-08-07',
      citation: 'Added support for remote MCP servers',
      type: 'ajout',
      prompt: 'Étudie cette nouveauté',
      vuLe: '2026-08-13T00:00:00.000Z',
      statut: 'nouveau'
    }
  ],
  echecs: [
    {
      concurrent: 'Cursor',
      url: 'https://y.test',
      detail: 'HTTP 503',
      vuLe: '2026-08-13T00:00:00.000Z'
    }
  ]
}

function api(): void {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      ticketSources: vi.fn(async () => [
        { profile: DEFAULT_TICKET_SOURCE, credentialConfigured: false }
      ]),
      listTickets: vi.fn(async (): Promise<TicketPage> => ({
        items: [fiche('1'), fiche('2')],
        hasMore: false
      })),
      saveTicketSource: vi.fn(),
      cancelTickets: vi.fn(async () => false),
      listTicketPeople: vi.fn(async () => []),
      conversations: vi.fn(async () => []),
      veilleSnapshot: vi.fn(async () => stockVeille)
    }
  })
}

let root: Root | null = null
let hote: HTMLDivElement | null = null

async function monter(): Promise<HTMLDivElement> {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  root = createRoot(hote)
  await act(async () => {
    root!.render(createElement(TicketsView, { active: true }))
    await Promise.resolve()
    await Promise.resolve()
  })
  return hote
}

afterEach(async () => {
  await act(async () => root?.unmount())
  hote?.remove()
  root = null
  hote = null
  localStorage.clear()
  vi.restoreAllMocks()
  appliquerLangue('fr')
})

const parTestId = (zone: HTMLElement, id: string): HTMLElement | null =>
  zone.querySelector(`[data-testid="${id}"]`)

async function ouvrirOnglet(zone: HTMLElement, libelle: string): Promise<void> {
  const onglet = [...zone.querySelectorAll('button')].find((b) => b.textContent === libelle)
  expect(onglet, `onglet « ${libelle} »`).toBeDefined()
  await act(async () => {
    onglet!.click()
    await Promise.resolve()
    await Promise.resolve()
  })
}

describe('écran Tickets — langue', () => {
  it('sources externes : bascule en anglais sans être remonté, puis revient au français', async () => {
    api()
    const zone = await monter()
    expect(parTestId(zone, 'tickets-refresh')?.textContent).toBe('Actualiser')
    expect(parTestId(zone, 'tickets-select-all')?.textContent).toBe('Tout sélectionner (2)')

    await act(async () => appliquerLangue('en'))
    expect(zone.textContent).toContain(
      'Syncs and drives the work coming from your external sources.'
    )
    expect(zone.textContent).toContain('External sources')
    expect(parTestId(zone, 'tickets-refresh')?.textContent).toBe('Refresh')
    expect(parTestId(zone, 'tickets-refresh')?.getAttribute('aria-label')).toBe(
      'Refresh the tickets'
    )
    expect(parTestId(zone, 'tickets-search-server')?.textContent).toBe('Search')
    expect(parTestId(zone, 'tickets-select-all')?.textContent).toBe('Select all (2)')
    expect(parTestId(zone, 'tickets-treat-selection')?.textContent).toBe('Prepare the prompt (0)')
    expect(parTestId(zone, 'tickets-mode-send')?.textContent).toBe('Really handle (immediate send)')
    expect(parTestId(zone, 'tickets-page-end')?.textContent).toBe('End of the list')
    expect(parTestId(zone, 'tickets-stats')?.textContent).toContain('shown · scope: loaded page')
    expect(zone.querySelector('input[type="search"]')?.getAttribute('placeholder')).toBe(
      'ID, title or assignee… (Enter = server search)'
    )
    expect(parTestId(zone, 'ticket-detail')?.textContent).toContain('Unassigned')
    expect(parTestId(zone, 'ticket-detail')?.textContent).toContain('No description.')
    expect(
      zone.querySelector('[data-testid="ticket-open-conversation"]')?.getAttribute('aria-label')
    ).toBe('Open a conversation for ticket 1')

    await act(async () => appliquerLangue('fr'))
    expect(parTestId(zone, 'tickets-refresh')?.textContent).toBe('Actualiser')
    expect(parTestId(zone, 'tickets-page-end')?.textContent).toBe('Fin de la liste')
    expect(parTestId(zone, 'ticket-detail')?.textContent).toContain('Aucune description.')
  })

  it('section Autowin OS : les candidats de veille passent en anglais, puis reviennent', async () => {
    api()
    appliquerLangue('en')
    const zone = await monter()
    await ouvrirOnglet(zone, 'Autowin OS')
    expect(parTestId(zone, 'veille-compte')?.textContent).toBe('1candidate')
    expect(parTestId(zone, 'veille-actualiser')?.textContent).toBe('Refresh')
    expect(parTestId(zone, 'veille-generer')?.textContent).toBe('Generate more')
    expect(parTestId(zone, 'veille-jamais-lue')?.textContent).toBe('no reading done yet')
    expect(parTestId(zone, 'veille-echecs')?.textContent).toContain(
      '1 source silent at the last reading'
    )
    expect(parTestId(zone, 'veille-pertinence-absente')?.textContent).toBe('not scored')
    expect(zone.querySelector('.veille-prompter')?.textContent).toBe('Prompt in Autowin')
    expect(zone.querySelector('a.veille-source')?.textContent).toBe('open the source')
    expect(zone.querySelector('.veille-statut')?.textContent).toBe('new')

    await act(async () => appliquerLangue('fr'))
    expect(parTestId(zone, 'veille-generer')?.textContent).toBe('En générer plus')
    expect(parTestId(zone, 'veille-echecs')?.textContent).toContain(
      '1 source muette à la dernière lecture'
    )
    expect(zone.querySelector('.veille-statut')?.textContent).toBe('nouveau')
  })
})
