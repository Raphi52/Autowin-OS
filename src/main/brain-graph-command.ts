import { appendBrainTrace, type BrainTrace } from './activity/brain-trace-spool'
import { sharedBrainOrigin } from './brain-paths'
import { readSignedBrainPayload, verifySignedBrainPayload } from './brain-protocol'

/**
 * COMMANDES `brain_graph` et `brain_read` — la memoire que l'agent PILOTE lui-meme.
 *
 * `brain_query` rend des extraits classes par une recherche : l'agent ne choisit ni la note ni le
 * lien a suivre. Il manquait deux gestes : suivre un lien (« qui depend de X », route `/graph`
 * du Brain, construite sur les liens deja extraits) et relire UNE note nommee en entier (route
 * `/read`, confinee a `knowledge/` cote serveur). L'ecriture reste `remember` (candidat en revue),
 * qui accepte desormais `supersedes` pour signaler qu'une note lue est perimee.
 *
 * Ne throw jamais : une panne est un resultat lisible par le modele, pas une exception.
 */

export interface BrainMemoryDeps {
  token: string
  origin?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  corpus?: readonly string[] | null
}

export interface BrainMemoryOutcome {
  found: boolean
  status: 'found' | 'empty' | 'invalid' | 'unavailable' | 'not-requested'
  knowledge: string
  note?: string
}

const DIRECTIONS = new Set(['dependents', 'dependencies'])

async function callBrain(
  route: '/graph' | '/read',
  body: Record<string, unknown>,
  deps: BrainMemoryDeps
): Promise<BrainMemoryOutcome> {
  let origin: string
  try {
    origin = deps.origin ?? sharedBrainOrigin()
  } catch {
    return {
      found: false,
      status: 'unavailable',
      knowledge: '',
      note: "origine du Brain (AUTOWIN_BRAIN_ORIGIN) invalide - rien n'a ete envoye"
    }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 10_000) // sleep-ok: borne d'abort d'un fetch
  try {
    const response = await (deps.fetchFn ?? fetch)(`${origin}${route}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${deps.token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify(deps.corpus ? { ...body, corpus: deps.corpus } : body)
    })
    const payload = await readSignedBrainPayload(response)
    if (!response.ok) {
      const raw = (payload as { error?: unknown }).error
      const error = typeof raw === 'string' ? raw : `HTTP ${response.status}`
      return {
        found: false,
        status: response.status === 404 ? 'empty' : 'unavailable',
        knowledge: '',
        note: `refuse par le Brain : ${error}`
      }
    }
    let context: string
    try {
      context = verifySignedBrainPayload(payload, deps.token).context
    } catch {
      return {
        found: false,
        status: 'invalid',
        knowledge: '',
        note: "reponse Brain rejetee : identite ou integrite invalide - rien n'a ete utilise"
      }
    }
    // Aucune coupe côté app (2026-09-27) : `brain_read` rend la note ENTIÈRE que l'agent a choisi
    // d'ouvrir. Le graphe, lui, reste borné par le serveur (`/graph`), qui le dit (`truncated`).
    return {
      found: Boolean(context.trim()),
      status: context.trim() ? 'found' : 'empty',
      knowledge: context.trim()
    }
  } catch {
    return {
      found: false,
      status: 'unavailable',
      knowledge: '',
      note: 'service Brain indisponible - ne pas conclure que la reponse est negative ; diagnostique le serveur Brain'
    }
  } finally {
    clearTimeout(timer)
  }
}

/** « Qui depend de X » (dependents) ou « de quoi X depend » (dependencies). */
export async function runBrainGraph(
  args: Record<string, unknown>,
  deps: BrainMemoryDeps
): Promise<BrainMemoryOutcome> {
  const entity = typeof args.entity === 'string' ? args.entity.trim().slice(0, 300) : ''
  if (!entity) {
    return { found: false, status: 'not-requested', knowledge: '', note: 'entite manquante' }
  }
  const direction =
    typeof args.direction === 'string' && DIRECTIONS.has(args.direction)
      ? args.direction
      : 'dependents'
  const parsedDepth = Number(args.depth)
  const depth = Number.isFinite(parsedDepth) ? Math.min(Math.max(Math.trunc(parsedDepth), 1), 3) : 1
  const relation =
    typeof args.relation === 'string' && args.relation.trim()
      ? args.relation.trim().slice(0, 64)
      : undefined
  const outcome = await callBrain(
    '/graph',
    { entity, direction, depth, ...(relation ? { relation } : {}) },
    deps
  )
  if (outcome.status !== 'found') return outcome
  // Le graphe dit lui-meme s'il a trouve l'entite : « aucun resultat » n'est pas « entite inconnue ».
  try {
    const parsed = JSON.parse(outcome.knowledge) as { found?: boolean; ambiguous?: boolean }
    if (parsed.found === false) {
      return {
        ...outcome,
        found: false,
        status: 'empty',
        note: parsed.ambiguous
          ? 'entite ambigue - reprends un des identifiants de `matches`'
          : 'entite absente du graphe - essaie son identifiant exact ou brain_query'
      }
    }
  } catch {
    // Resultat non JSON (serveur ancien, coupe cote serveur) : il reste lisible tel quel.
  }
  return outcome
}

/** Relire UNE note curee nommee (chemin `knowledge/...md`, tel que rendu par brain_query/brain_graph). */
export async function runBrainRead(
  args: Record<string, unknown>,
  deps: BrainMemoryDeps
): Promise<BrainMemoryOutcome> {
  const path = typeof args.path === 'string' ? args.path.trim().slice(0, 400) : ''
  if (!path) {
    return { found: false, status: 'not-requested', knowledge: '', note: 'chemin de note manquant' }
  }
  // `entier` : la note ENTIÈRE. Sans ce drapeau, le serveur garde l'ancienne coupe à 3 000
  // caractères, réservée aux clients antérieurs au 2026-09-27 qui rejetaient tout contexte plus long.
  return callBrain('/read', { path, entier: true }, deps)
}
// fix-ok: plus de borne de contenu cote app (2026-09-27) ; seules les gardes de transport de brain-protocol.ts restent

/** Identifiant du point de registre (`activity/brain-injection-points.ts`) des lectures du modèle. */
export const POINT_LECTURE_BRAIN = 'command-brain-read'

/**
 * TRACE D'UNE LECTURE BRAIN — `brain_read` (note entière) ou `brain_graph` (liens).
 *
 * POURQUOI (conv-1303, 2026-10-30) : ces deux commandes injectaient du savoir Brain dans le prompt
 * sans écrire aucune trace. Mesure du 22 au 30/10 : 148 notes entières, 347 000 caractères — plus
 * que tout le bloc des notes proches (159 000) —, absents de l'Observatory et du registre qui se dit
 * exhaustif. La trace porte le chemin ouvert (`notes`) : c'est lui qui permet de compter, note par
 * note, combien de fois une note servie a été réellement lue.
 *
 * Ne jette jamais : `appendBrainTrace` avale ses propres pannes et les compte.
 */
export function tracerLectureBrain(
  outil: 'brain_read' | 'brain_graph',
  args: Record<string, unknown>,
  outcome: BrainMemoryOutcome,
  meta: { conversationId?: string; turnId?: string; durationMs?: number },
  emettre: (trace: BrainTrace) => unknown = appendBrainTrace
): void {
  if (!meta.conversationId) return
  const brute = outil === 'brain_read' ? args.path : args.entity
  // Même forme que les chemins servis par les notes proches (barres obliques avant).
  const cible = (typeof brute === 'string' ? brute : '').trim().replace(/[\\]/g, '/').slice(0, 400)
  emettre({
    timestamp: new Date().toISOString(),
    conversationId: meta.conversationId,
    ...(meta.turnId ? { turnId: meta.turnId } : {}),
    kind: 'lecture',
    point: POINT_LECTURE_BRAIN,
    query: `${outil}: ${cible}`,
    found: outcome.found,
    status: outcome.status === 'not-requested' ? 'empty' : outcome.status,
    ...(meta.durationMs !== undefined ? { durationMs: meta.durationMs } : {}),
    injectedChars: outcome.knowledge.length,
    ...(outil === 'brain_read' && cible ? { notes: [cible] } : {})
  })
}
