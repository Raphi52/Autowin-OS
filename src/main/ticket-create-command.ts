/**
 * Commande agent « ticket_create » — créer une fiche chez le fournisseur de tickets.
 *
 * C'est la première commande du catalogue qui ÉCRIT dans un système externe PARTAGÉ : la fiche
 * apparaît dans le backlog de l'équipe, sous l'identité de l'utilisateur. Deux règles en découlent,
 * et elles sont la raison d'être de ce module (pur, donc testable sans réseau ni Electron) :
 *
 *  1. **Le modèle ne choisit pas la cible, il la NOMME au plus.** Un profil de source fabriqué par
 *     le modèle est IGNORÉ ; seul un `sourceId` est écouté, et le profil correspondant est relu dans
 *     le store côté main. `TicketService` refuse déjà un profil non autorisé — mais il ne faut même
 *     pas laisser le modèle exprimer cette intention.
 *  2. **On ne devine pas le projet.** Si plusieurs sources sont configurées et qu'aucune n'est
 *     nommée, on REFUSE en listant les ids. Créer la fiche dans le mauvais projet est un dégât
 *     visible par toute l'équipe, et « la première de la liste » n'est pas une intention.
 *
 * Les bornes de VALIDITÉ des champs (longueurs, forme du type) ne sont pas ici : elles vivent dans
 * `TicketService`, seule autorité, pour que l'IPC et l'agent ne puissent pas diverger.
 */
import type { TicketItem, TicketSourceProfile } from '../shared/tickets'
import type { TicketCreateRequest } from './ticket-providers/provider-contract'

/** Arguments tels que le MODÈLE les émet : tout est `unknown`, rien n'est supposé. */
export interface TicketCreateArgs {
  title?: unknown
  description?: unknown
  workItemType?: unknown
  assignee?: unknown
  sourceId?: unknown
  /** Toléré en entrée pour ne pas planter, mais délibérément IGNORÉ (cf. règle 1). */
  source?: unknown
}

/** Ce que la commande retiendra de la demande du modèle, une fois nettoyée. */
export type TicketCreateDecision =
  | {
      allowed: true
      request: Omit<TicketCreateRequest, 'source'>
      sourceId?: string
    }
  | { allowed: false; reason: string }

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Nettoie et valide la FORME de la demande du modèle. Ne touche pas à la cible. */
export function decideTicketCreate(args: TicketCreateArgs): TicketCreateDecision {
  const title = text(args?.title)
  if (!title) {
    return {
      allowed: false,
      reason: 'Titre requis : donne un titre court et explicite pour la fiche.'
    }
  }
  const description = text(args?.description)
  const workItemType = text(args?.workItemType)
  const assignee = text(args?.assignee)
  const sourceId = text(args?.sourceId)
  return {
    allowed: true,
    request: {
      title,
      ...(description ? { description } : {}),
      ...(workItemType ? { workItemType } : {}),
      ...(assignee ? { assignee } : {})
    },
    ...(sourceId ? { sourceId } : {})
  }
}

export type TicketSourceResolution =
  | { ok: true; source: TicketSourceProfile }
  | { ok: false; reason: string }

/** Résout la source cible depuis le store. Refuse plutôt que de deviner (cf. règle 2). */
export function resolveTicketCreateSource(
  sources: readonly TicketSourceProfile[],
  sourceId: string | undefined
): TicketSourceResolution {
  if (sources.length === 0) {
    return {
      ok: false,
      reason: 'Aucune source Tickets configurée : ajoute-la dans Settings avant de créer une fiche.'
    }
  }
  const ids = sources.map((source) => source.id).join(', ')
  if (sourceId) {
    const found = sources.find((source) => source.id === sourceId)
    if (!found) {
      return { ok: false, reason: `Source Tickets « ${sourceId} » inconnue. Disponibles : ${ids}.` }
    }
    return { ok: true, source: found }
  }
  if (sources.length > 1) {
    return {
      ok: false,
      reason: `Plusieurs sources Tickets sont configurées : précise sourceId. Disponibles : ${ids}.`
    }
  }
  return { ok: true, source: sources[0] as TicketSourceProfile }
}

export interface TicketCreateCommandDeps {
  listSources: () => readonly TicketSourceProfile[]
  /** Absent = capacité non câblée (instance de test, ou service Tickets indisponible). */
  create?: (request: TicketCreateRequest) => Promise<TicketItem>
}

export type TicketCreateOutcome =
  | { ok: true; created: TicketItem }
  | { ok: false; reason: string }

/**
 * Exécute la création pour le compte de l'agent. Ne throw JAMAIS : un échec est un RÉSULTAT que le
 * modèle doit pouvoir lire et corriger, pas une exception qui casse son tour.
 */
export async function createTicketFromCommand(
  args: TicketCreateArgs,
  deps: TicketCreateCommandDeps
): Promise<TicketCreateOutcome> {
  const decision = decideTicketCreate(args)
  if (!decision.allowed) return { ok: false, reason: decision.reason }

  const resolved = resolveTicketCreateSource(deps.listSources(), decision.sourceId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }

  if (!deps.create) {
    return {
      ok: false,
      reason: 'Création de fiche indisponible : le service Tickets n’est pas configuré.'
    }
  }
  try {
    const created = await deps.create({ ...decision.request, source: resolved.source })
    return { ok: true, created }
  } catch (error) {
    return {
      ok: false,
      reason: `Création refusée par le fournisseur : ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}
