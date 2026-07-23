/**
 * Layout d'AFFICHAGE d'un tour dans la timeline Observatory — ne touche PAS aux données de trace
 * (events atomiques conservés). Deux transformations purement visuelles :
 *  1. Regroupe les events SORTANTS (message + injection + boundary/options) en un item `sortant`
 *     unique, mis en avant : c'est ce qui part chez le provider à ce tour.
 *  2. Dédup la réponse : `response-displayed` (texte réellement peint) est MASQUÉ quand il est
 *     identique (normalisé) au `model-response` (brut provider) → une seule ligne « Réponse ».
 *     S'il DIVERGE, on le garde et on le marque `diverges` (badge rouge côté rendu). C'est une
 *     preuve de fidélité : la donnée n'est jamais supprimée, seulement masquée à l'affichage
 *     quand elle n'apporte rien.
 */

/** Events sortants regroupés sous « Sortant ». */
const OUTGOING_KINDS = new Set(['message', 'injection', 'boundary'])

export interface MinimalEvent {
  kind: string
  content: string
}

export type TurnRenderItem<E extends MinimalEvent> =
  | { type: 'sortant'; events: E[] }
  | { type: 'event'; event: E; diverges?: boolean }

/** Normalise pour comparer deux textes de réponse (espaces/bords ignorés). */
export function normalizeResponse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

/**
 * Le `response-displayed` est-il identique au(x) `model-response` du tour ?
 * (identique ⇒ on le masque ; sinon ⇒ divergence).
 */
function displayedMatchesModel(displayed: string, modelResponses: string[]): boolean {
  const d = normalizeResponse(displayed)
  if (!d) return true // rien affiché de significatif → pas une divergence à signaler
  return modelResponses.some((m) => normalizeResponse(m) === d)
}

export function layoutTurnEvents<E extends MinimalEvent>(events: E[]): TurnRenderItem<E>[] {
  const modelResponses = events.filter((e) => e.kind === 'model-response').map((e) => e.content)
  const items: TurnRenderItem<E>[] = []
  let outgoing: E[] = []
  const flush = (): void => {
    if (outgoing.length) {
      items.push({ type: 'sortant', events: outgoing })
      outgoing = []
    }
  }
  for (const event of events) {
    if (OUTGOING_KINDS.has(event.kind)) {
      outgoing.push(event)
      continue
    }
    flush()
    if (event.kind === 'response-displayed') {
      const diverges = !displayedMatchesModel(event.content, modelResponses)
      if (!diverges) continue // identique au brut → masqué (une seule « Réponse »)
      items.push({ type: 'event', event, diverges: true })
      continue
    }
    items.push({ type: 'event', event })
  }
  flush()
  return items
}
