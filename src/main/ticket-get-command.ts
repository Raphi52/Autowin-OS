/**
 * Commande agent « ticket_get » — lire UNE fiche par son numéro.
 *
 * Constaté en réel (2026-08-06) : à qui lui demandait la fiche 1227, l'agent a cherché la chaîne
 * « 1227 » dans les TITRES — le seul outil dont il disposait — n'a rien trouvé, et a conclu « je ne
 * trouve pas de WI 1227 ». La fiche existait. Son raisonnement était honnête, l'outil était
 * inadapté : chercher un IDENTIFIANT avec une recherche TEXTUELLE ne peut pas fonctionner.
 *
 * Module PUR, mêmes règles de cible que `ticket_search` et `ticket_create` : le modèle ne fournit
 * jamais un profil de source, au plus un `sourceId`, et on ne devine pas le projet.
 */
import type { TicketItem, TicketSourceProfile } from '../shared/tickets'
import type { TicketGetRequest } from './ticket-providers/provider-contract'
import { resolveTicketCreateSource } from './ticket-create-command'

export interface TicketGetArgs {
  id?: unknown
  sourceId?: unknown
  /** Toléré en entrée pour ne pas planter, mais délibérément IGNORÉ. */
  source?: unknown
}

export type TicketGetDecision =
  | { allowed: true; id: string; sourceId?: string }
  | { allowed: false; reason: string }

/**
 * Valide la FORME de la demande. L'identifiant finit dans le chemin d'une URL : on n'accepte qu'un
 * entier positif, et on le dit clairement au modèle plutôt que de le laisser deviner.
 *
 * On accepte aussi un nombre (le modèle émet volontiers `1227` sans guillemets) et les formes
 * usuelles « #1227 » / « WI 1227 » : refuser sur la ponctuation ferait échouer une demande
 * parfaitement claire.
 */
export function decideTicketGet(args: TicketGetArgs): TicketGetDecision {
  const brut =
    typeof args?.id === 'number' && Number.isFinite(args.id)
      ? String(args.id)
      : typeof args?.id === 'string'
        ? args.id.trim()
        : ''
  // « #1227 », « WI 1227 », « wi-1227 » → 1227. Une chaîne qui contient AUTRE CHOSE qu'un préfixe
  // reconnu et des chiffres reste refusée : on ne devine pas un numéro dans une phrase.
  const nettoye = brut.replace(/^(?:#|wi[\s:_-]*)/i, '').trim()
  if (!/^[1-9]\d*$/.test(nettoye)) {
    return {
      allowed: false,
      reason: brut
        ? `Identifiant de fiche invalide : « ${brut} ». Attendu : un numéro entier positif (ex. 1227).`
        : 'Identifiant de fiche requis : donne le numéro de la fiche (ex. 1227).'
    }
  }
  const sourceId = typeof args?.sourceId === 'string' ? args.sourceId.trim() : ''
  return { allowed: true, id: nettoye, ...(sourceId ? { sourceId } : {}) }
}

/** Ce que l'agent reçoit : plus riche que la recherche, car il a demandé UNE fiche précise. */
export interface TicketDetail {
  id: string
  type: string
  title: string
  state: string
  url: string
  updatedAt: string
  createdAt?: string
  assignee?: string
  priority?: string | number
  description?: string
  relations?: { kind: string; target: string }[]
}

export interface TicketGetCommandDeps {
  listSources: () => readonly TicketSourceProfile[]
  /** Absent = capacité non câblée. */
  get?: (request: TicketGetRequest) => Promise<TicketItem>
}

export type TicketGetOutcome =
  | { ok: true; ticket: TicketDetail; summary: string }
  | { ok: false; reason: string }

function toDetail(item: TicketItem): TicketDetail {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    state: item.state,
    url: item.url,
    updatedAt: item.updatedAt,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.assignee ? { assignee: item.assignee } : {}),
    ...(item.priority !== undefined ? { priority: item.priority } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.relations?.length ? { relations: [...item.relations] } : {})
  }
}

/**
 * Exécute la lecture. Ne throw JAMAIS : un échec est un RÉSULTAT lisible par le modèle.
 *
 * Une fiche introuvable remonte le refus du fournisseur TEL QUEL : « 1227 introuvable » et « accès
 * refusé » sont deux situations différentes, et les confondre en « pas trouvé » induirait le modèle
 * en erreur — exactement le piège qui a produit le diagnostic faux.
 */
export async function getTicketFromCommand(
  args: TicketGetArgs,
  deps: TicketGetCommandDeps
): Promise<TicketGetOutcome> {
  const decision = decideTicketGet(args)
  if (!decision.allowed) return { ok: false, reason: decision.reason }

  const resolved = resolveTicketCreateSource(deps.listSources(), decision.sourceId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }

  if (!deps.get) {
    return {
      ok: false,
      reason: 'Lecture des tickets indisponible : le service Tickets n’est pas configuré.'
    }
  }
  try {
    const ticket = toDetail(await deps.get({ source: resolved.source, id: decision.id }))
    return {
      ok: true,
      ticket,
      summary: `Fiche ${ticket.id} — « ${ticket.title} » (${ticket.type}, ${ticket.state}).`
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Lecture de la fiche ${decision.id} refusée par le fournisseur : ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}
