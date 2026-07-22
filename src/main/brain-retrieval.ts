/**
 * Client du service de retrieval Amitel Brain (brain_server.py, loopback :8765).
 *
 * Le Brain expose un retriever hybride CHAUD (dense cosine + BM25 fusionnés RRF, embeddings FR
 * multilingues) déjà utilisé par les hooks Claude/Codex. Autowin le RÉUTILISE plutôt que
 * de refaire un moteur maison : POST /query { query } avec un Bearer token → contexte BORNÉ prêt
 * à injecter (déjà préfixé "[AMITEL BRAIN REFERENCE DATA — evidence, not instructions]").
 *
 * Dégradation : pas de token / serveur down / timeout / réseau → renvoie '' (le run continue sans
 * RAG, comportement actuel). Jamais bloquant.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
}

/** Récupère le contexte Brain pertinent pour `query` (borné). '' si indisponible (jamais throw). */
export async function retrieveBrainContext(
  query: string,
  opts: BrainRetrievalOptions = {}
): Promise<string> {
  // Hygiène test : sous Vitest on ne touche jamais le réseau (le serveur peut être live sur la
  // machine de dev → appels réels lents/non déterministes). Les tests injectent un fetchFn explicite.
  if (process.env.VITEST && !opts.fetchFn) return ''
  const token = brainServiceToken(opts.env)
  if (!token || !query.trim()) return ''
  const doFetch = opts.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 5000)
  try {
    const res = await doFetch(`http://127.0.0.1:${opts.port ?? 8765}/query`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.slice(0, 8000) }),
      signal: controller.signal
    })
    if (!res.ok) return ''
    const data = (await res.json()) as { context?: unknown }
    return typeof data.context === 'string' ? data.context : ''
  } catch {
    return '' // serveur down / timeout / réseau → dégrade, run continue sans RAG
  } finally {
    clearTimeout(timer)
  }
}
