import { BRAIN_INJECTION_POINTS, type BrainPointKind } from './brain-injection-points'
import type { BrainTrace } from './brain-trace-spool'

/**
 * INVENTAIRE DES APPELS BRAIN — ce que l'Observatory affiche quand il promet « toutes les injections
 * et tous les appels au Brain ». La liste des points vient du REGISTRE (donc un point sans aucun
 * appel apparaît quand même, à zéro : une absence se voit), les compteurs viennent des TRACES réelles.
 *
 * Un panneau qui ne montrerait que les traces existantes ne pourrait jamais dire « ce point n'a pas
 * été appelé » — il dirait seulement « je n'ai rien ». C'est précisément la confusion à éviter.
 */
export interface BrainInjectionPointInventory {
  id: string
  label: string
  kind: BrainPointKind
  injecte: boolean
  emission: 'spool' | 'porte-par-appelant' | 'non-trace'
  pourquoi: string
  /** Appels tracés, toutes conversations confondues (spool lisible). */
  appelsTotal: number
  /** Appels tracés dans la conversation regardée. */
  appelsConversation: number
  /** Caractères Brain réellement injectés dans la conversation regardée. */
  caracteresConversation: number
  /** Horodatage du dernier appel connu (toutes conversations). */
  dernierAppel?: string
}

export interface BrainInjectionInventory {
  points: BrainInjectionPointInventory[]
  /** Traces antérieures au registre, non rattachables à un point sans ambiguïté. */
  tracesNonRattachees: number
  totalTraces: number
  /** Points déclarés dont AUCUN appel n'a jamais été tracé (état, pas erreur). */
  pointsJamaisAppeles: string[]
}

/**
 * Rattachement d'une trace à un point. Les traces écrites AVANT le registre n'ont pas de `point` :
 * leur `kind` suffit quand il ne désigne qu'un seul point (`write` en désigne deux → non rattachée,
 * plutôt qu'attribuée au hasard).
 */
export function pointDeTrace(trace: Pick<BrainTrace, 'point' | 'kind'>): string | undefined {
  if (trace.point && BRAIN_INJECTION_POINTS.some((p) => p.id === trace.point)) return trace.point
  if (trace.point) return undefined
  /**
   * DEUX VOCABULAIRES, une correspondance EXPLICITE. Le spool nomme la nature d'un aller-retour
   * (`recherche`, `depot`, `pousse`), le registre nomme la nature d'un POINT (`search`, `write`,
   * `push`). Les rapprocher par egalite de chaine ne rattachait donc plus rien depuis que le spool
   * a renomme ses valeurs : chaque trace historique tombait en « non rattachee », et l'inventaire
   * affichait des zeros partout sans le dire.
   */
  const CORRESPONDANCE: Record<string, BrainPointKind> = {
    automatic: 'automatic',
    query: 'query',
    empreinte: 'empreinte',
    recherche: 'search',
    depot: 'write',
    pousse: 'push'
  }
  const kind = CORRESPONDANCE[trace.kind ?? 'automatic']
  if (!kind) return undefined
  const candidats = BRAIN_INJECTION_POINTS.filter((p) => p.kind === kind)
  return candidats.length === 1 ? candidats[0].id : undefined
}

export function buildBrainInjectionInventory(
  traces: readonly BrainTrace[],
  conversationId?: string
): BrainInjectionInventory {
  const points = BRAIN_INJECTION_POINTS.map<BrainInjectionPointInventory>((point) => ({
    id: point.id,
    label: point.label,
    kind: point.kind,
    injecte: point.injecte,
    emission: point.emission,
    pourquoi: point.pourquoi,
    appelsTotal: 0,
    appelsConversation: 0,
    caracteresConversation: 0
  }))
  const parId = new Map(points.map((p) => [p.id, p]))
  let tracesNonRattachees = 0
  for (const trace of traces) {
    const id = pointDeTrace(trace)
    const entree = id ? parId.get(id) : undefined
    if (!entree) {
      tracesNonRattachees += 1
      continue
    }
    entree.appelsTotal += 1
    if (!entree.dernierAppel || Date.parse(trace.timestamp) > Date.parse(entree.dernierAppel)) {
      entree.dernierAppel = trace.timestamp
    }
    if (conversationId !== undefined && trace.conversationId === conversationId) {
      entree.appelsConversation += 1
      entree.caracteresConversation += Math.max(0, trace.injectedChars || 0)
    }
  }
  return {
    points,
    tracesNonRattachees,
    totalTraces: traces.length,
    pointsJamaisAppeles: points
      .filter((p) => p.emission === 'spool' && p.appelsTotal === 0)
      .map((p) => p.id)
  }
}
