/**
 * Layout d'AFFICHAGE d'un tour dans la timeline Observatory — ne touche PAS aux données de trace
 * (events atomiques conservés). Regroupe les events par ZONE, chacune encadrée d'une couleur :
 *  - `sortant`  (bleu)   : message + injection + options — ce qui part au provider.
 *  - `reponse`  (jaune)  : model-response + response-displayed (dédupliqués, cf. divergence).
 *  - `sousagent`(violet) : handoff (délégation) + verdict (jugement) — activité sous-agents.
 *  - hors zone : events isolés (décision, outil, contrôle, retry, annulation, erreur).
 *
 * Dédup réponse : `response-displayed` (texte peint) est MASQUÉ quand il est identique (normalisé)
 * au `model-response` (brut) → une seule ligne. S'il DIVERGE, on le garde et on le marque `diverges`
 * (badge rouge au rendu). Preuve de fidélité : la donnée n'est jamais supprimée, seulement masquée
 * quand elle n'apporte rien.
 */

export type TurnZone = 'sortant' | 'reponse' | 'sousagent'

/** Zone d'affichage d'un event (les kinds absents = hors zone, rendus isolés). */
const ZONE_OF: Record<string, TurnZone> = {
  message: 'sortant',
  injection: 'sortant',
  boundary: 'sortant',
  'model-response': 'reponse',
  'response-displayed': 'reponse',
  handoff: 'sousagent',
  verdict: 'sousagent'
}

export interface MinimalEvent {
  kind: string
  content: string
}

export interface GroupedEvent<E extends MinimalEvent> {
  event: E
  diverges?: boolean
}

export type TurnRenderItem<E extends MinimalEvent> =
  | { type: 'group'; zone: TurnZone; events: Array<GroupedEvent<E>> }
  | { type: 'event'; event: E }

/** Normalise pour comparer deux textes de réponse (espaces/bords ignorés). */
export function normalizeResponse(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function displayedMatchesModel(displayed: string, modelResponses: string[]): boolean {
  const d = normalizeResponse(displayed)
  if (!d) return true // rien affiché de significatif → pas une divergence à signaler
  return modelResponses.some((m) => normalizeResponse(m) === d)
}

export function layoutTurnEvents<E extends MinimalEvent>(events: E[]): TurnRenderItem<E>[] {
  const modelResponses = events.filter((e) => e.kind === 'model-response').map((e) => e.content)
  const items: TurnRenderItem<E>[] = []
  let buffer: { zone: TurnZone; events: Array<GroupedEvent<E>> } | null = null
  const flush = (): void => {
    if (buffer && buffer.events.length) items.push({ type: 'group', ...buffer })
    buffer = null
  }
  for (const event of events) {
    const zone = ZONE_OF[event.kind]
    if (!zone) {
      flush()
      items.push({ type: 'event', event })
      continue
    }
    // Dédup réponse : masquer le displayed identique ; le garder+marquer s'il diverge.
    let diverges: boolean | undefined
    if (event.kind === 'response-displayed') {
      diverges = !displayedMatchesModel(event.content, modelResponses)
      if (!diverges) continue
    }
    if (!buffer || buffer.zone !== zone) {
      flush()
      buffer = { zone, events: [] }
    }
    buffer.events.push(diverges ? { event, diverges } : { event })
  }
  flush()
  return items
}
