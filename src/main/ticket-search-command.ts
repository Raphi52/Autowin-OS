/**
 * Commande agent « ticket_search » — LIRE les work items du fournisseur de tickets.
 *
 * Constaté en réel (2026-08-06) : à qui lui demandait « regarde s'il n'y a pas déjà un autre work
 * item sur ce sujet », l'agent répondait « je n'ai pas d'accès Azure DevOps depuis ici ». Exact, mais
 * trompeur : l'app est parfaitement connectée — canal `tickets:list`, adaptateur Azure, credentials
 * configurés, et l'onglet Tickets affiche la liste. Ce qui manquait était une commande exposant cette
 * lecture à l'agent. Il savait `navigate` vers l'onglet, ce qui change seulement ce que
 * l'UTILISATEUR voit, sans jamais lui donner accès à la donnée.
 *
 * Module PUR : la décision et la mise en forme sont testables sans réseau ni Electron.
 *
 * Deux règles héritées de `ticket_create`, pour les mêmes raisons :
 *  1. le modèle ne fournit JAMAIS un profil de source — au plus un `sourceId`, et le profil est relu
 *     dans le store côté main ;
 *  2. on ne DEVINE pas le projet : plusieurs sources et aucune nommée → refus en listant les ids.
 *
 * Le filtre `titleContains` est indispensable et non cosmétique : la lecture sous-jacente balaie le
 * projet par id CROISSANT, donc sans filtre il faudrait parcourir des milliers d'items pour trouver
 * un doublon. L'échappement WIQL de ce filtre vit dans l'adaptateur, sa borne de longueur dans le
 * service — ici on ne fait que valider la FORME de la demande du modèle.
 */
import type { TicketItem, TicketListRequest, TicketSourceProfile } from '../shared/tickets'
import { resolveTicketCreateSource } from './ticket-create-command'

/** Taille de page par défaut : assez pour juger, assez petit pour ne pas noyer le contexte. */
const DEFAULT_PAGE_SIZE = 25
const MAX_PAGE_SIZE = 100
/** Alignée sur la borne du service, pour refuser AVANT l'appel plutôt qu'après. */
const MAX_QUERY_LENGTH = 400

/** Arguments tels que le MODÈLE les émet : tout est `unknown`, rien n'est supposé. */
export interface TicketSearchArgs {
  query?: unknown
  pageSize?: unknown
  cursor?: unknown
  sourceId?: unknown
  /** Toléré en entrée pour ne pas planter, mais délibérément IGNORÉ (cf. règle 1). */
  source?: unknown
}

export type TicketSearchDecision =
  | { allowed: true; request: Omit<TicketListRequest, 'source'>; sourceId?: string }
  | { allowed: false; reason: string }

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')

/** Nettoie et valide la FORME de la demande. Ne touche pas à la cible. */
export function decideTicketSearch(args: TicketSearchArgs): TicketSearchDecision {
  const titleContains = text(args?.query)
  if (titleContains.length > MAX_QUERY_LENGTH) {
    return {
      allowed: false,
      reason: `Recherche trop longue (max ${MAX_QUERY_LENGTH} caractères) : abrège les mots-clés.`
    }
  }
  // Une taille de page absurde ou illisible ne fait PAS échouer la commande : on la ramène dans la
  // plage utile. Le modèle demande une lecture, pas une négociation de pagination.
  const asked = Number(args?.pageSize)
  const pageSize = Number.isFinite(asked)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(asked)))
    : DEFAULT_PAGE_SIZE
  const cursor = text(args?.cursor)
  const sourceId = text(args?.sourceId)
  return {
    allowed: true,
    request: {
      pageSize,
      ...(titleContains ? { titleContains } : {}),
      ...(cursor ? { cursor } : {})
    },
    ...(sourceId ? { sourceId } : {})
  }
}

/** Ce que l'agent reçoit : le strict nécessaire pour juger, pas le work item entier. */
export interface TicketSearchHit {
  id: string
  type: string
  title: string
  state: string
  url: string
  assignee?: string
  updatedAt: string
}

export interface TicketSearchCommandDeps {
  listSources: () => readonly TicketSourceProfile[]
  /** Absent = capacité non câblée (instance de test, ou service Tickets indisponible). */
  list?: (
    request: TicketListRequest
  ) => Promise<{ items: TicketItem[]; hasMore: boolean; cursor?: string }>
}

export type TicketSearchOutcome =
  | {
      ok: true
      items: TicketSearchHit[]
      hasMore: boolean
      /**
       * À repasser en `cursor` pour obtenir la suite. Présent SEULEMENT si `hasMore`.
       *
       * Constaté en réel (2026-08-06) : sans lui, un agent annonçant « il en reste » n'avait aucun
       * moyen de continuer. Il a vu 100 fiches couvrant les ids 1 à 175, puis a conclu que le projet
       * s'arrêtait à 175 — alors qu'il compte 780 fiches, id max 1278. Annoncer une suite sans donner
       * le moyen de l'atteindre pousse le modèle à inventer une conclusion.
       */
      cursor?: string
      summary: string
    }
  | { ok: false; reason: string }

/** Projection volontairement étroite : ni `fields`, ni `relations`, ni description. */
function toHit(item: TicketItem): TicketSearchHit {
  return {
    id: item.id,
    type: item.type,
    title: item.title,
    state: item.state,
    url: item.url,
    updatedAt: item.updatedAt,
    ...(item.assignee ? { assignee: item.assignee } : {})
  }
}

/**
 * Exécute la lecture pour le compte de l'agent. Ne throw JAMAIS : un échec est un RÉSULTAT que le
 * modèle doit pouvoir lire et corriger.
 *
 * « Aucun résultat » est un SUCCÈS, et le résumé le dit explicitement : le modèle doit pouvoir
 * conclure « rien trouvé » sans confondre avec « la recherche a échoué ». C'est exactement la nuance
 * qu'il avait su faire sur le Brain (« résultat vide, pas une réponse négative »).
 */
export async function searchTicketsFromCommand(
  args: TicketSearchArgs,
  deps: TicketSearchCommandDeps
): Promise<TicketSearchOutcome> {
  const decision = decideTicketSearch(args)
  if (!decision.allowed) return { ok: false, reason: decision.reason }

  const resolved = resolveTicketCreateSource(deps.listSources(), decision.sourceId)
  if (!resolved.ok) return { ok: false, reason: resolved.reason }

  if (!deps.list) {
    return {
      ok: false,
      reason: 'Lecture des tickets indisponible : le service Tickets n’est pas configuré.'
    }
  }
  try {
    const page = await deps.list({ ...decision.request, source: resolved.source })
    const items = page.items.map(toHit)
    const cherche = decision.request.titleContains
    // On ne FABRIQUE pas de curseur : si la couche basse n'en rend pas, on n'en invente pas (déduire
    // « le dernier id vu » serait faux dès que le tri change).
    const cursor = typeof page.cursor === 'string' && page.cursor ? page.cursor : undefined
    const suite = page.hasMore
      ? cursor
        ? ` Il en reste : rappelle ticket_search avec cursor="${cursor}".`
        : ' Il en reste, mais aucun curseur n’a été fourni : la suite est inatteignable.'
      : ''
    const summary =
      items.length === 0
        ? cherche
          ? `Aucun ticket ne contient « ${cherche} » dans son titre.`
          : 'Aucun ticket trouvé.'
        : `${items.length} ticket(s)${cherche ? ` contenant « ${cherche} »` : ''}.${suite}`
    return {
      ok: true,
      items,
      hasMore: page.hasMore,
      ...(cursor ? { cursor } : {}),
      summary
    }
  } catch (error) {
    return {
      ok: false,
      reason: `Lecture refusée par le fournisseur : ${
        error instanceof Error ? error.message : String(error)
      }`
    }
  }
}
