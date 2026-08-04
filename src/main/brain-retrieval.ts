/**
 * Client du service de retrieval Amitel Brain (brain_server.py, loopback :8765).
 *
 * Le Brain expose un retriever CHAUD dense + lexical + graphe, fusionné par RRF. Autowin le réutilise
 * via POST /query avec bearer token, corpus de workspace et réponse HMAC signée.
 *
 * Toute dégradation reste non bloquante et typée : empty, invalid ou unavailable.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { readSignedBrainPayload, verifySignedBrainPayload } from './brain-protocol'

type FetchLike = typeof fetch

/** Token de service : env AMITEL_BRAIN_TOKEN, sinon %LOCALAPPDATA%\AmitelBrain\service-token. */
export function brainServiceToken(env: NodeJS.ProcessEnv = process.env): string {
  if (env.AMITEL_BRAIN_TOKEN) return env.AMITEL_BRAIN_TOKEN
  const base = env.LOCALAPPDATA
    ? join(env.LOCALAPPDATA, 'AmitelBrain', 'service-token')
    : join(env.HOME ?? '', '.amitel-brain', 'service-token')
  try {
    return existsSync(base) ? readFileSync(base, 'ascii').trim() : ''
  } catch {
    return ''
  }
}

export interface BrainRetrievalOptions {
  timeoutMs?: number
  port?: number
  fetchFn?: FetchLike
  env?: NodeJS.ProcessEnv
  /** Horloge injectable — les tests font expirer la mémoire courte sans attendre. */
  now?: () => number
  /** Identités/préfixes de chemins ancrés autorisés, dérivés du workspace courant. */
  corpus?: readonly string[]
}

/** Un candidat parcouru par le retriever : rang fusionné, chemin, score dense, retenu ou écarté. */
export interface BrainRelation {
  type: 'related' | 'supersedes' | 'contradicts' | 'caused_by' | 'links_to'
  target: string
}

export interface BrainNavigationCandidate {
  rank: number
  path: string
  type: string
  denseCos: number
  denseScore?: number
  lexicalScore?: number
  graphScore?: number
  fusedScore?: number
  relations?: BrainRelation[]
  retained: boolean
  /** Tranche OCTETS (fichier brut) du chunk retenu — permet de surligner le passage réellement injecté. */
  chunkByteStart?: number
  chunkByteEnd?: number
}

/** Navigation interne du Brain pour une requête (parcouru → scoré → retenu). */
export interface BrainNavigation {
  query: string
  minDense: number
  /** Racine Brain absolue : le `path` des candidats est relatif à elle → le client résout l'absolu. */
  root?: string
  candidates: BrainNavigationCandidate[]
}

/** Résultat d'une récupération Brain : contexte injecté + (si le serveur l'expose) sa navigation. */
export type BrainRetrievalStatus = 'found' | 'empty' | 'invalid' | 'unavailable'

export interface BrainRetrievalResult {
  context: string
  navigation?: BrainNavigation
  status: BrainRetrievalStatus
}

const MAX_NAVIGATION_CANDIDATES = 100
const MAX_NAVIGATION_RELATIONS = 50
const MAX_NAVIGATION_TEXT = 4096
const ALLOWED_RELATION_TYPES = new Set([
  'related',
  'supersedes',
  'contradicts',
  'caused_by',
  'links_to'
])

function finiteNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function parseNavigation(raw: unknown): BrainNavigation | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const nav = raw as Record<string, unknown>
  if (!Array.isArray(nav.candidates)) return undefined
  const candidates: BrainNavigationCandidate[] = nav.candidates
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === 'object')
    .slice(0, MAX_NAVIGATION_CANDIDATES)
    .map((c) => {
      const relations = Array.isArray(c.relations)
        ? c.relations
            .slice(0, MAX_NAVIGATION_RELATIONS)
            .filter(
              (relation): relation is Record<string, unknown> =>
                Boolean(relation) && typeof relation === 'object'
            )
            .filter(
              (relation) =>
                ALLOWED_RELATION_TYPES.has(String(relation.type)) &&
                typeof relation.target === 'string' &&
                relation.target.trim().length > 0
            )
            .map((relation) => ({
              type: String(relation.type) as BrainRelation['type'],
              target: String(relation.target).slice(0, MAX_NAVIGATION_TEXT)
            }))
        : []
      return {
        rank: finiteNumber(c.rank),
        path: String(c.path ?? '').slice(0, MAX_NAVIGATION_TEXT),
        type: String(c.type ?? '').slice(0, 100),
        denseCos: finiteNumber(c.denseCos),
        ...(typeof c.denseScore === 'number' && Number.isFinite(c.denseScore)
          ? { denseScore: c.denseScore }
          : {}),
        ...(typeof c.lexicalScore === 'number' && Number.isFinite(c.lexicalScore)
          ? { lexicalScore: c.lexicalScore }
          : {}),
        ...(typeof c.graphScore === 'number' && Number.isFinite(c.graphScore)
          ? { graphScore: c.graphScore }
          : {}),
        ...(typeof c.fusedScore === 'number' && Number.isFinite(c.fusedScore)
          ? { fusedScore: c.fusedScore }
          : {}),
        ...(relations.length > 0 ? { relations } : {}),
        retained: Boolean(c.retained),
        chunkByteStart:
          typeof c.chunkByteStart === 'number' && Number.isFinite(c.chunkByteStart)
            ? c.chunkByteStart
            : undefined,
        chunkByteEnd:
          typeof c.chunkByteEnd === 'number' && Number.isFinite(c.chunkByteEnd)
            ? c.chunkByteEnd
            : undefined
      }
    })
  return {
    query: String(nav.query ?? '').slice(0, 8000),
    minDense: finiteNumber(nav.minDense),
    root: typeof nav.root === 'string' ? nav.root.slice(0, MAX_NAVIGATION_TEXT) : undefined,
    candidates
  }
}

/**
 * Mémoire courte des récupérations : même requête, même corpus ⇒ même résultat.
 *
 * Mesuré sur un journal réel : 15 appels pour 4 requêtes distinctes sur une seule conversation, et
 * 24 appels redondants sur 51 au total — ~26 800 caractères réinjectés pour rien, plus ~500 ms
 * d'attente à chaque fois. Relancer une tâche est légitime ; réinterroger le Brain avec la MÊME
 * question dans la foulée n'apprend rien.
 *
 * Volontairement COURT : le Brain est un corpus vivant (le hook d'ingestion y écrit). Un cache long
 * servirait du savoir périmé — ce serait pire que le gâchis qu'il évite.
 */
const RETRIEVAL_CACHE_TTL_MS = 5 * 60 * 1000
const RETRIEVAL_CACHE_MAX = 32
const retrievalCache = new Map<string, { at: number; result: BrainRetrievalResult }>()

/** Vide la mémoire courte — pour les tests, et pour un rechargement explicite du corpus. */
export function clearBrainRetrievalCache(): void {
  retrievalCache.clear()
}

/**
 * Récupère le contexte Brain pertinent pour `query` (borné) + sa navigation interne si le serveur
 * l'expose. `{ context: '' }` si indisponible (jamais throw). Dégrade proprement : un serveur ancien
 * sans champ `navigation` → `navigation` undefined, le run continue.
 *
 * Une requête identique servie il y a moins de {@link RETRIEVAL_CACHE_TTL_MS} est rendue depuis la
 * mémoire courte, sans appel réseau.
 */
export async function retrieveBrainContext(
  query: string,
  opts: BrainRetrievalOptions = {}
): Promise<BrainRetrievalResult> {
  // `[]` est une décision fail-closed explicite du résolveur workspace : aucun appel global ne doit
  // pouvoir contourner une identité de dépôt inconnue. `undefined` reste le wildcard volontaire.
  if (opts.corpus && opts.corpus.length === 0) return { context: '', status: 'empty' }
  // Hygiène test : sous Vitest on ne touche jamais le réseau (le serveur peut être live sur la
  // machine de dev → appels réels lents/non déterministes). Les tests injectent un fetchFn explicite.
  if (process.env.VITEST && !opts.fetchFn) return { context: '', status: 'unavailable' }
  const token = brainServiceToken(opts.env)
  if (!token || !query.trim()) return { context: '', status: 'unavailable' }
  // Mémoire courte AVANT le réseau : une question déjà posée ne se repose pas.
  const now = opts.now?.() ?? Date.now()
  const corpus = (opts.corpus ?? []).map((fragment) => fragment.trim()).filter(Boolean)
  const cacheKey = `${opts.port ?? 8765}|${corpus.join(',')}|${query.trim()}`
  const cached = retrievalCache.get(cacheKey)
  if (cached && now - cached.at < RETRIEVAL_CACHE_TTL_MS) return cached.result
  const doFetch = opts.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000)
  try {
    const res = await doFetch(`http://127.0.0.1:${opts.port ?? 8765}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: query.slice(0, 8000),
        ...(corpus.length > 0 ? { corpus } : {})
      }),
      signal: controller.signal
    })
    if (!res.ok) return { context: '', status: 'unavailable' }
    let verified: ReturnType<typeof verifySignedBrainPayload>
    try {
      const data = await readSignedBrainPayload(res)
      verified = verifySignedBrainPayload(data, token)
    } catch {
      return { context: '', status: 'invalid' }
    }
    const context = verified.context
    const result: BrainRetrievalResult = {
      context,
      navigation: parseNavigation(verified.navigation),
      status: context ? 'found' : 'empty'
    }
    // On ne mémorise QUE les réponses servies : un serveur indisponible ne doit pas figer un vide.
    retrievalCache.set(cacheKey, { at: now, result })
    if (retrievalCache.size > RETRIEVAL_CACHE_MAX) {
      const oldest = retrievalCache.keys().next().value
      if (oldest) retrievalCache.delete(oldest)
    }
    return result
  } catch {
    return { context: '', status: 'unavailable' } // serveur down / timeout / réseau
  } finally {
    clearTimeout(timer)
  }
}
