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
  /** Notes servies souvent et jamais ouvertes (voir `notesServiesJamaisOuvertes`). */
  notesBruyantes: NoteBruyante[]
  /** Première ouverture tracée : avant elle, « jamais ouverte » ne peut pas se dire. */
  mesureOuverturesDepuis?: string
  /** Seuil de `notesBruyantes`, transmis pour que l'interface l'affiche sans le recopier. */
  seuilNotesBruyantes: number
}

export interface NoteBruyante {
  chemin: string
  /** Blocs de notes proches qui l'ont servie depuis le début de la mesure. */
  servies: number
  /** Fils distincts où elle a été servie. */
  fils: number
}

/** Points du registre lus ici (`brain-injection-points.ts`) ; le test vérifie qu'ils y existent. */
export const POINT_NOTES_PROCHES = 'chat-titres-du-tour'
export const POINT_LECTURE = 'command-brain-read'
export const NOTE_BRUYANTE_SEUIL = 10
const NOTES_BRUYANTES_MAX = 15

/**
 * NOTES SERVIES SOUVENT, JAMAIS OUVERTES (conv-1303, 2026-10-30) — de quoi nourrir `/curate`.
 *
 * Mesure du 13 au 30/10 : les notes « plan de lots » ont été servies 46 fois sans une ouverture,
 * une note d'état passager (« conv-1146 : travail non commité… ») 23 fois. Une telle note répond à
 * des messages génériques (titre trop large, ou état périmé) : c'est à la curation de la resserrer
 * ou de la retirer, pas au tri de la cacher.
 *
 * HONNÊTE SUR SA FENÊTRE : `brain_read` n'était pas tracé avant le 30/10. Compter les blocs servis
 * avant la PREMIÈRE ouverture tracée ferait passer pour « jamais ouverte » une note lue à l'époque.
 * Le compte commence donc à cette première ouverture ; sans elle, la liste est vide et le dit.
 * Seul le champ `notes` des traces fait foi (chemins exacts), pas une sélection rejouée.
 */
export function notesServiesJamaisOuvertes(
  traces: readonly BrainTrace[],
  seuil = NOTE_BRUYANTE_SEUIL
): { depuis?: string; notes: NoteBruyante[] } {
  const lectures = traces.filter((t) => t.point === POINT_LECTURE)
  if (lectures.length === 0) return { notes: [] }
  const depuis = lectures
    .map((t) => t.timestamp)
    .reduce((min, ts) => (Date.parse(ts) < Date.parse(min) ? ts : min))
  const ouvertes = new Set(lectures.flatMap((t) => t.notes ?? []))
  const servies = new Map<string, { servies: number; fils: Set<string> }>()
  for (const t of traces) {
    if (t.point !== POINT_NOTES_PROCHES || !t.notes) continue
    if (Date.parse(t.timestamp) < Date.parse(depuis)) continue
    for (const chemin of t.notes) {
      const entree = servies.get(chemin) ?? { servies: 0, fils: new Set<string>() }
      entree.servies += 1
      entree.fils.add(t.conversationId)
      servies.set(chemin, entree)
    }
  }
  const notes = [...servies.entries()]
    .filter(([chemin, e]) => e.servies >= seuil && !ouvertes.has(chemin))
    .map(([chemin, e]) => ({ chemin, servies: e.servies, fils: e.fils.size }))
    .sort((a, b) => b.servies - a.servies || a.chemin.localeCompare(b.chemin))
    .slice(0, NOTES_BRUYANTES_MAX)
  return { depuis, notes }
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
    pousse: 'push',
    lecture: 'read'
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
  const bruyantes = notesServiesJamaisOuvertes(traces)
  return {
    points,
    tracesNonRattachees,
    totalTraces: traces.length,
    pointsJamaisAppeles: points
      .filter((p) => p.emission === 'spool' && p.appelsTotal === 0)
      .map((p) => p.id),
    notesBruyantes: bruyantes.notes,
    seuilNotesBruyantes: NOTE_BRUYANTE_SEUIL,
    ...(bruyantes.depuis ? { mesureOuverturesDepuis: bruyantes.depuis } : {})
  }
}
