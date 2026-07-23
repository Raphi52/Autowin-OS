import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import { PREFLIGHT_SCHEMA } from './native-preflight'
import { redactTrace } from './trace-redact'
import { NATIVE_TRACE_SOURCE, type NativePreflightWireV1 } from '../../shared/native-trace-contract'

/**
 * SPOOL DE TRACES NATIF.
 *
 * Autowin écrit LUI-MÊME ses traces de pré-requête (au format `autowin.native-preflight/v1`, lu tel
 * quel par `readNativePreflight`), sans dépendre d'un spool externe
 * Ainsi l'Observatory (preuve d'injection + traçabilité RAG
 * « Amitel Brain ») se peuple sur les VRAIES requêtes envoyées par les providers d'Autowin.
 *
 * Le `system` (qui porte le marqueur RAG « [AMITEL BRAIN REFERENCE DATA] » + le contexte projet)
 * est inclus comme 1er message → `summarizeRagTrace` le détecte comme pour une trace native.
 * Secrets redcatés via `redactTrace` (même politique que la lecture). Rotation simple à ~4 Mo.
 */

const SPOOL_MAX_BYTES = 4 * 1024 * 1024

export function nativeSpoolRoot(base = ensureAutowinAppData()): string {
  const root = join(base, 'native-trace-spool')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

export interface NativeTraceInput {
  provider: string
  model?: string
  conversationId?: string
  turnId?: string
  system?: string
  messages: Array<{ role: string; content: string }>
  tools?: unknown[]
  timestamp: string // injecté (Date.now() interdit dans certains contextes) — l'appelant le fournit
}

/** Compose l'enregistrement au schéma preflight (le `system` devient un message role=system). */
export function buildNativeTrace(input: NativeTraceInput): NativePreflightWireV1 {
  const messages = [
    ...(input.system ? [{ role: 'system', content: input.system }] : []),
    ...input.messages
  ]
  return {
    schema: PREFLIGHT_SCHEMA,
    source: NATIVE_TRACE_SOURCE,
    timestamp: input.timestamp,
    session_id: input.conversationId ?? 'native',
    turn_id: input.turnId ?? 'native',
    api_request_id: `native:${input.timestamp}`,
    provider: input.provider,
    model: input.model ?? 'unknown',
    ...(input.conversationId ? { conversation_id: input.conversationId } : {}),
    request: redactTrace({ body: { messages, tools: input.tools ?? [] } }) as Record<
      string,
      unknown
    >
  }
}

/** Écrit une trace native (append-only, JSONL, rotation best-effort). Ne jette jamais. */
export function appendNativeTrace(input: NativeTraceInput, base = ensureAutowinAppData()): void {
  try {
    const root = nativeSpoolRoot(base)
    const path = join(root, 'events.jsonl')
    if (existsSync(path) && statSync(path).size > SPOOL_MAX_BYTES) {
      renameSync(path, join(root, 'events.previous.jsonl'))
    }
    appendFileSync(path, `${JSON.stringify(buildNativeTrace(input))}\n`, 'utf8')
  } catch {
    // La trace est un bonus d'observabilité : son échec ne casse jamais l'appel provider.
  }
}
