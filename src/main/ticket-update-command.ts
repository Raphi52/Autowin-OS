/** Commande agent `ticket_update` : clôturer la boucle avec le fournisseur de tickets. */
import type { TicketItem, TicketSourceProfile } from '../shared/tickets'
import type { TicketUpdateRequest } from './ticket-providers/provider-contract'
import { resolveTicketCreateSource } from './ticket-create-command'
import { decideTicketGet } from './ticket-get-command'

export interface TicketUpdateArgs {
  id?: unknown
  sourceId?: unknown
  comment?: unknown
  state?: unknown
  assignee?: unknown
  /**
   * Champs libres `{ "Custom.DLL": "…" }`, indexés par leur nom de référence côté fournisseur.
   * Permet de remplir les onglets métier d'une fiche, que `state` et `assignee` n'atteignent pas.
   */
  fields?: unknown
  /** Toléré mais ignoré : la cible est toujours relue dans le store. */
  source?: unknown
}

export interface TicketUpdateCommandDeps {
  listSources: () => readonly TicketSourceProfile[]
  update?: (request: TicketUpdateRequest) => Promise<TicketItem>
}

export type TicketUpdateOutcome =
  { ok: true; updated: TicketItem; summary: string } | { ok: false; reason: string }

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/**
 * Ne retient que les entrées exploitables : une clé qui ressemble à un nom de référence
 * (`Custom.DLL`, `System.Title`) et une valeur texte non vide. Une valeur vide est écartée
 * plutôt qu'envoyée : effacer un champ métier n'est pas ce que demande un compte-rendu.
 */
const fieldsOf = (value: unknown): Record<string, string> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const retained: Record<string, string> = {}
  for (const [reference, raw] of Object.entries(value as Record<string, unknown>)) {
    const name = reference.trim()
    const written = text(raw)
    if (!/^[A-Za-z][\w]*(\.[\w-]+)+$/.test(name) || !written) continue
    retained[name] = written
  }
  return retained
}

export async function updateTicketFromCommand(
  args: TicketUpdateArgs,
  deps: TicketUpdateCommandDeps
): Promise<TicketUpdateOutcome> {
  const id = decideTicketGet(args)
  if (!id.allowed) return { ok: false, reason: id.reason }
  const comment = text(args?.comment)
  const state = text(args?.state)
  const assignee = text(args?.assignee)
  const fields = fieldsOf(args?.fields)
  const hasFields = Object.keys(fields).length > 0
  if (!comment && !state && !assignee && !hasFields) {
    return {
      ok: false,
      reason: 'Mise à jour vide : fournis un commentaire, un état, un assigné ou des champs.'
    }
  }
  const resolved = resolveTicketCreateSource(deps.listSources(), id.sourceId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }
  if (!deps.update) {
    return {
      ok: false,
      reason: 'Mise à jour des tickets indisponible : le service Tickets n’est pas configuré.'
    }
  }
  try {
    const updated = await deps.update({
      source: resolved.source,
      id: id.id,
      ...(comment ? { comment } : {}),
      ...(state ? { state } : {}),
      ...(assignee ? { assignee } : {}),
      ...(hasFields ? { fields } : {})
    })
    return {
      ok: true,
      updated,
      summary: `Fiche ${updated.id} mise à jour — état « ${updated.state} ».`
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Mise à jour de la fiche ${id.id} refusée par le fournisseur : ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}
