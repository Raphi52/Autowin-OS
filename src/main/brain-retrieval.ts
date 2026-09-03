/**
 * Client du service de retrieval Amitel Brain (brain_server.py, loopback).
 *
 * L'origine vient de `amitelBrainOrigin()` (env `AMITEL_BRAIN_ORIGIN`, defaut 127.0.0.1:8765), jamais
 * d'une constante locale : une adresse ecrite en dur ici envoyait les requetes sur un autre port que
 * celui reellement configure, donc sur un autre service — jeton different, reponse rejetee `invalid`.
 *
 * Le Brain expose un retriever CHAUD dense + lexical + graphe, fusionné par RRF. Autowin le réutilise
 * via POST /query avec bearer token, corpus de workspace et réponse HMAC signée.
 *
 * Toute dégradation reste non bloquante et typée : empty, invalid ou unavailable.
 */
import { existsSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import {
  readSignedBrainPayload,
  sealBrainRequest,
  verifySignedBrainPayload
} from './brain-protocol'
import { amitelBrainOrigin } from './amitel-paths'

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
  /** Surcharge de test/diagnostic. Absent = origine CONFIGUREE (`AMITEL_BRAIN_ORIGIN`). */
  port?: number
  fetchFn?: FetchLike
  env?: NodeJS.ProcessEnv
  /** Identifiant injectable pour corréler une récupération sans journaliser la requête. */
  traceId?: () => string
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
  /** Sélecteurs effectivement appliqués par le serveur, dans l'enveloppe HMAC. */
  corpus?: readonly string[]
  /** Frontières signées : le client ne redéduit jamais les sources depuis du Markdown ambigu. */
  structuredContext?: {
    preamble: string
    sources: ReadonlyArray<{ path: string; content: string }>
  }
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
 * Récupère le contexte Brain pertinent pour `query` (borné) + sa navigation interne si le serveur
 * l'expose. `{ context: '' }` si indisponible (jamais throw). Dégrade proprement : un serveur ancien
 * sans champ `navigation` → `navigation` undefined, le run continue.
 *
 * Chaque appel consulte le service : le protocole v1 ne transporte pas de génération authentifiée,
 * donc un cache client rendrait les publications du Brain invisibles jusqu'à son expiration.
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
  const corpus = (opts.corpus ?? []).map((fragment) => fragment.trim()).filter(Boolean)
  const doFetch = opts.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000)
  try {
    const origin = opts.port
      ? `http://127.0.0.1:${opts.port}`
      : amitelBrainOrigin(opts.env ?? process.env)
    /*
     * LE NONCE EST EMIS PAR LE SERVEUR, pas par nous. Mesure du 2026-09-02 sur le service vivant :
     * `GET /challenge` REFUSE toute chaine de requete (`if parsed.query: 400`) et rend son propre
     * nonce a usage unique, seul accepte ensuite par `/query-secure` (`challenges.consume`). Le
     * client imposait le sien via `?nonce=…` : chaque lecture repartait donc sur un 400, et le
     * savoir n'arrivait jamais. Ce sens-la est aussi le plus sur : c'est l'emetteur du nonce qui
     * garantit son unicite, et sa signature HMAC prouve qui l'a emis.
     */
    const challengeResponse = await doFetch(`${origin}/challenge`, {
      method: 'GET',
      signal: controller.signal
    })
    if (!challengeResponse.ok) return { context: '', status: 'unavailable' }
    let nonce: string
    try {
      const challenge = verifySignedBrainPayload(
        await readSignedBrainPayload(challengeResponse),
        token
      )
      const challengeNonce = /^challenge:([0-9a-f]{24})$/.exec(challenge.context)?.[1]
      if (!challengeNonce) return { context: '', status: 'invalid' }
      nonce = challengeNonce
    } catch {
      return { context: '', status: 'invalid' }
    }

    const requestPayload = {
      // Même sémantique que Python : trim puis borne en points de code, sans couper un surrogate.
      query: Array.from(query.trim()).slice(0, 8000).join(''),
      harness: 'autowin-os',
      trace_id: Array.from(opts.traceId?.() ?? randomUUID())
        .slice(0, 128)
        .join(''),
      ...(corpus.length > 0 ? { corpus } : {})
    }
    const res = await doFetch(`${origin}/query-secure`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sealBrainRequest(requestPayload, token, nonce)),
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
    // Le contexte livré est la seule vérité du statut : des espaces signés ne constituent pas du savoir.
    const context = verified.context.trim()
    if (
      !verified.request ||
      verified.request.query !== requestPayload.query ||
      verified.request.traceId !== requestPayload.trace_id
    ) {
      return { context: '', status: 'invalid' }
    }
    if (
      corpus.length > 0 &&
      (verified.corpus?.length !== corpus.length ||
        verified.corpus.some((selector, index) => selector !== corpus[index]))
    ) {
      return { context: '', status: 'invalid' }
    }
    const navigation = parseNavigation(verified.navigation)
    if (navigation && navigation.query !== requestPayload.query) {
      return { context: '', status: 'invalid' }
    }
    if (!context && navigation?.candidates.some((candidate) => candidate.retained)) {
      return { context: '', status: 'invalid' }
    }
    const result: BrainRetrievalResult = {
      context,
      navigation,
      ...(verified.corpus ? { corpus: verified.corpus } : {}),
      ...(verified.structuredContext ? { structuredContext: verified.structuredContext } : {}),
      status: context ? 'found' : 'empty'
    }
    return result
  } catch {
    return { context: '', status: 'unavailable' } // serveur down / timeout / réseau
  } finally {
    clearTimeout(timer)
  }
}
