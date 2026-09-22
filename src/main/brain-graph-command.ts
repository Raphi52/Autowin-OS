import { amitelBrainOrigin } from './amitel-paths'
import { readSignedBrainPayload, verifySignedBrainPayload } from './brain-protocol'
import { capBrainResult } from './brain-query-command'

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
    origin = deps.origin ?? amitelBrainOrigin()
  } catch {
    return {
      found: false,
      status: 'unavailable',
      knowledge: '',
      note: "origine du Brain (AMITEL_BRAIN_ORIGIN) invalide - rien n'a ete envoye"
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
    return {
      found: Boolean(context.trim()),
      status: context.trim() ? 'found' : 'empty',
      knowledge: capBrainResult(context)
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
    // Resultat tronque par capBrainResult : il reste lisible tel quel.
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
  return callBrain('/read', { path }, deps)
}
// fix-ok: contexte borne a 3000 caracteres par assertContextBound (brain-protocol.ts) + avertissements lint sur mes lignes
