import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_TICKET_SOURCE, type TicketItem, type TicketSourceProfile } from '../shared/tickets'
import { decideTicketCreate, resolveTicketCreateSource } from './ticket-create-command'

/**
 * COMMANDE AGENT « ticket_create ».
 *
 * C'est la première commande du catalogue qui ÉCRIT dans un système externe partagé : la fiche
 * apparaît dans le backlog de l'équipe, sous l'identité de l'utilisateur. Deux garde-fous
 * spécifiques en découlent, et ce sont eux que ces tests verrouillent.
 *
 * 1. L'agent ne fournit JAMAIS un profil de source complet — seulement, au plus, un `sourceId`. Le
 *    profil est relu dans le store côté main. Sinon le modèle pourrait viser une organisation Azure
 *    arbitraire en fabriquant un profil, ce que `TicketService` refuse déjà, mais qu'il ne faut même
 *    pas laisser exprimer.
 * 2. Quand aucune source n'est nommée et que PLUSIEURS sont configurées, on REFUSE au lieu de
 *    deviner : créer la fiche dans le mauvais projet est un dégât visible par toute l'équipe, et
 *    « la première de la liste » n'est pas une intention.
 */
const OTHER_SOURCE: TicketSourceProfile = {
  ...DEFAULT_TICKET_SOURCE,
  id: 'autre-projet',
  project: 'AutreProjet'
}

describe('decideTicketCreate — ce que l’agent est autorisé à demander', () => {
  it('un titre utile suffit', () => {
    const decision = decideTicketCreate({ title: 'Créer les fiches depuis Autowin' })
    expect(decision.allowed).toBe(true)
    if (decision.allowed) expect(decision.request.title).toBe('Créer les fiches depuis Autowin')
  })

  it('REFUSE un titre absent, vide ou fait d’espaces, avec un motif lisible', () => {
    for (const title of [undefined, '', '   ', 42, null]) {
      const decision = decideTicketCreate({ title })
      expect(decision.allowed).toBe(false)
      if (!decision.allowed) expect(decision.reason).toMatch(/titre/i)
    }
  })

  it('transmet la description et le type quand ils sont fournis, rognés', () => {
    const decision = decideTicketCreate({
      title: '  Titre  ',
      description: '  Contexte  ',
      workItemType: ' Bug '
    })
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.request).toMatchObject({
        title: 'Titre',
        description: 'Contexte',
        workItemType: 'Bug'
      })
    }
  })

  it('IGNORE un profil de source fabriqué par le modèle — seul un sourceId est écouté', () => {
    const decision = decideTicketCreate({
      title: 'Titre',
      source: { ...DEFAULT_TICKET_SOURCE, organization: 'org-pirate' },
      sourceId: 'mon-projet'
    })
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.request).not.toHaveProperty('source')
      expect(decision.sourceId).toBe('mon-projet')
    }
  })

  it('un champ vide n’est pas transmis (ne pas écraser le défaut du fournisseur)', () => {
    const decision = decideTicketCreate({ title: 'Titre', description: '   ', workItemType: '' })
    expect(decision.allowed).toBe(true)
    if (decision.allowed) {
      expect(decision.request).not.toHaveProperty('description')
      expect(decision.request).not.toHaveProperty('workItemType')
    }
  })
})

describe('resolveTicketCreateSource — on ne devine pas le projet cible', () => {
  it('une seule source configurée : elle est retenue sans que l’agent la nomme', () => {
    const resolved = resolveTicketCreateSource([DEFAULT_TICKET_SOURCE], undefined)
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.source).toEqual(DEFAULT_TICKET_SOURCE)
  })

  it('plusieurs sources et aucune nommée : REFUS, et les ids sont listés', () => {
    const resolved = resolveTicketCreateSource([DEFAULT_TICKET_SOURCE, OTHER_SOURCE], undefined)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.reason).toMatch(/plusieurs/i)
      expect(resolved.reason).toContain(DEFAULT_TICKET_SOURCE.id)
      expect(resolved.reason).toContain('autre-projet')
    }
  })

  it('un sourceId nommé sélectionne la bonne source parmi plusieurs', () => {
    const resolved = resolveTicketCreateSource(
      [DEFAULT_TICKET_SOURCE, OTHER_SOURCE],
      'autre-projet'
    )
    expect(resolved.ok).toBe(true)
    if (resolved.ok) expect(resolved.source).toEqual(OTHER_SOURCE)
  })

  it('un sourceId inconnu est REFUSÉ, avec les ids réellement disponibles', () => {
    const resolved = resolveTicketCreateSource([DEFAULT_TICKET_SOURCE], 'nexiste-pas')
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) {
      expect(resolved.reason).toMatch(/nexiste-pas/)
      expect(resolved.reason).toContain(DEFAULT_TICKET_SOURCE.id)
    }
  })

  it('aucune source configurée : REFUS qui dit quoi faire', () => {
    const resolved = resolveTicketCreateSource([], undefined)
    expect(resolved.ok).toBe(false)
    if (!resolved.ok) expect(resolved.reason).toMatch(/aucune source|configur/i)
  })
})

/**
 * Le catalogue est lu par le MODÈLE : ses annotations pilotent la prudence de l'agent. Une action
 * qui écrit chez un tiers doit être annoncée comme telle, sinon l'agent la traitera comme une
 * lecture anodine.
 */
describe('catalogue — la commande s’annonce comme une écriture externe', () => {
  it('déclare openWorldHint et n’est ni readOnly ni idempotente', async () => {
    const { AppCommandBus } = await import('./commands')
    const bus = new AppCommandBus(
      {} as never,
      vi.fn(),
      undefined,
      undefined,
      () => true
    )
    const spec = bus.catalog().find((command) => command.name === 'ticket_create')

    expect(spec, 'ticket_create absent du catalogue').toBeDefined()
    expect(spec?.annotations?.readOnlyHint).toBe(false)
    expect(spec?.annotations?.idempotentHint).toBe(false)
    expect(spec?.annotations?.openWorldHint).toBe(true)
    expect(spec?.args).toHaveProperty('title')
  })
})

/**
 * Garde-fou : sans créateur câblé (instance de test, ou source Tickets non configurée), la commande
 * DIT que la capacité est indisponible. Un `throw` non rattrapé ferait échouer le tour de l'agent
 * sans lui expliquer quoi faire.
 */
describe('création indisponible', () => {
  it('rend un refus explicite plutôt qu’une exception', async () => {
    const { createTicketFromCommand } = await import('./ticket-create-command')

    const outcome = await createTicketFromCommand(
      { title: 'Titre' },
      { listSources: () => [DEFAULT_TICKET_SOURCE] }
    )

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toMatch(/indisponible|configur/i)
  })

  it('quand tout est câblé, la fiche créée est rendue avec son URL', async () => {
    const { createTicketFromCommand } = await import('./ticket-create-command')
    const created: TicketItem = {
      id: '4242',
      sourceId: DEFAULT_TICKET_SOURCE.id,
      type: 'Task',
      title: 'Titre',
      state: 'New',
      url: 'https://dev.azure.com/org/proj/_workitems/edit/4242',
      updatedAt: '2026-08-04T15:44:03Z',
      fields: {}
    }
    const create = vi.fn(async () => created)

    const outcome = await createTicketFromCommand(
      { title: 'Titre', workItemType: 'Task' },
      { listSources: () => [DEFAULT_TICKET_SOURCE], create }
    )

    expect(outcome.ok).toBe(true)
    if (outcome.ok) expect(outcome.created.url).toContain('/_workitems/edit/4242')
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ source: DEFAULT_TICKET_SOURCE, title: 'Titre', workItemType: 'Task' })
    )
  })

  it('un échec du fournisseur devient un refus lisible, pas une exception', async () => {
    const { createTicketFromCommand } = await import('./ticket-create-command')
    const create = vi.fn(async () => {
      throw new Error('403 Forbidden')
    })

    const outcome = await createTicketFromCommand(
      { title: 'Titre' },
      { listSources: () => [DEFAULT_TICKET_SOURCE], create }
    )

    expect(outcome.ok).toBe(false)
    if (!outcome.ok) expect(outcome.reason).toContain('403 Forbidden')
  })
})
