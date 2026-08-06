import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE } from '../../shared/tickets'
import { azureTicketProvider } from './azure'

/**
 * RECHERCHE par titre — le maillon qui manquait pour qu'un agent puisse répondre à « existe-t-il déjà
 * une fiche sur ce sujet ? ».
 *
 * Constaté en réel (2026-08-06) : l'agent d'Autowin savait `navigate` vers l'onglet Tickets, mais
 * n'avait AUCUN moyen de lire les work items. Il répondait « je n'ai pas d'accès Azure DevOps depuis
 * ici » — exact, mais trompeur : l'app est parfaitement connectée, c'est la capacité qui manquait.
 * Lister ne suffisait pas : la requête existante balaie TOUT le projet par id croissant, ce qui
 * obligerait à parcourir des milliers d'items pour trouver un doublon.
 *
 * LE POINT SENSIBLE, et la raison de ces tests : le texte cherché part dans une requête **WIQL**.
 * Une apostrophe non échappée y termine le littéral et laisse injecter la suite de la clause. WIQL
 * n'a pas de requête paramétrée : l'échappement est notre seule défense, il doit donc être testé
 * comme tel, pas supposé.
 */
function json(value: unknown, status = 200): Response {
  return Response.json(value, { status })
}

/** Deux réponses : la requête WIQL, puis le lot de work items. */
function fetchStub(): ReturnType<typeof vi.fn> {
  return vi
    .fn()
    .mockResolvedValueOnce(json({ workItems: [{ id: 1227 }] }))
    .mockResolvedValueOnce(
      json({
        value: [
          {
            id: 1227,
            url: 'https://dev.azure.com/AmitelGTC/RIG/_apis/wit/workItems/1227',
            fields: {
              'System.WorkItemType': 'Fiche Team',
              'System.Title': 'Facture retour client',
              'System.State': 'En cours',
              'System.ChangedDate': '2026-08-06T10:00:00.000Z'
            }
          }
        ]
      })
    )
}

/** Extrait la requête WIQL réellement envoyée. */
function wiqlOf(fetchFn: ReturnType<typeof vi.fn>): string {
  const init = fetchFn.mock.calls[0]?.[1] as { body?: string } | undefined
  return JSON.parse(init?.body ?? '{}').query ?? ''
}

describe('recherche Azure par titre — la clause WIQL', () => {
  it('sans recherche, la requête reste EXACTEMENT celle d’avant (aucune régression)', async () => {
    const fetchFn = fetchStub()
    await azureTicketProvider.list(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 1 },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )

    const q = wiqlOf(fetchFn)
    expect(q).not.toMatch(/CONTAINS/i)
    expect(q).toContain('[System.TeamProject] = @project')
  })

  it('avec une recherche, ajoute une clause CONTAINS sur le titre', async () => {
    const fetchFn = fetchStub()
    await azureTicketProvider.list(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 1, titleContains: 'facture retour' },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )

    expect(wiqlOf(fetchFn)).toContain("[System.Title] CONTAINS 'facture retour'")
  })

  /**
   * INJECTION WIQL — le cas qui justifie ce fichier. Sans échappement, `x' OR [System.Id] > 0 OR '`
   * refermerait le littéral et élargirait la requête à tout le projet.
   */
  it('ÉCHAPPE les apostrophes : une injection devient du texte cherché', async () => {
    const fetchFn = fetchStub()
    await azureTicketProvider.list(
      {
        source: DEFAULT_TICKET_SOURCE,
        pageSize: 1,
        titleContains: "x' OR [System.Id] > 0 OR '"
      },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )

    const q = wiqlOf(fetchFn)
    // L'apostrophe est doublée (échappement WIQL) → le littéral n'est jamais refermé par l'attaquant.
    expect(q).toContain("CONTAINS 'x'' OR [System.Id] > 0 OR '''")

    // La propriété de SÉCURITÉ, vérifiée structurellement : le texte injecté doit rester ENTIÈREMENT
    // à l'intérieur du littéral. On retire donc les littéraux (apostrophes doublées comprises) et on
    // constate qu'il ne subsiste aucun `OR` dans la STRUCTURE de la requête.
    // Chercher `OR` dans la requête brute ne prouverait rien : le mot est ici une DONNÉE cherchée.
    const structure = q.replace(/'(?:[^']|'')*'/g, "'…'")
    expect(structure).not.toMatch(/\bOR\b/)
    expect(structure).toContain("[System.Title] CONTAINS '…'")
  })

  it('un curseur et une recherche cohabitent sans se marcher dessus', async () => {
    const fetchFn = fetchStub()
    await azureTicketProvider.list(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 1, cursor: '100', titleContains: 'facture' },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )

    const q = wiqlOf(fetchFn)
    expect(q).toContain('[System.Id] > 100')
    expect(q).toContain("[System.Title] CONTAINS 'facture'")
    expect(q).toContain('ORDER BY [System.Id] ASC')
  })

  it('une recherche vide ou blanche est IGNORÉE (pas de clause vide qui ramène tout)', async () => {
    for (const titleContains of ['', '   ']) {
      const fetchFn = fetchStub()
      await azureTicketProvider.list(
        { source: DEFAULT_TICKET_SOURCE, pageSize: 1, titleContains },
        { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
      )
      expect(wiqlOf(fetchFn)).not.toMatch(/CONTAINS/i)
    }
  })

  it('la recherche est rognée de ses espaces de bordure', async () => {
    const fetchFn = fetchStub()
    await azureTicketProvider.list(
      { source: DEFAULT_TICKET_SOURCE, pageSize: 1, titleContains: '  facture  ' },
      { token: 'pat', fetchFn: fetchFn as unknown as typeof fetch }
    )
    expect(wiqlOf(fetchFn)).toContain("CONTAINS 'facture'")
  })
})
