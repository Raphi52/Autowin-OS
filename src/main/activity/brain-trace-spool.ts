import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { ensureAutowinAppData } from '../app-data'
import { redactTrace } from './trace-redact'
import type { BrainNavigation } from '../brain-retrieval'

/**
 * SPOOL DE TRACES BRAIN (observabilité Observatory) — Autowin enregistre, par run, ce que le Brain
 * a fait : la requête réelle envoyée, la navigation interne (candidats parcourus/scorés/retenus) et
 * les caractères injectés. Append-only JSONL, rotation ~2 Mo. Requête redactée (peut contenir des
 * secrets de tâche). Distinct du spool de traces natif (pré-requête provider).
 */
const SPOOL_MAX_BYTES = 2 * 1024 * 1024

export interface BrainTrace {
  timestamp: string
  conversationId: string
  /** Absent uniquement sur les traces historiques antérieures à la corrélation par tour. */
  turnId?: string
  query: string
  injectedChars: number
  navigation?: BrainNavigation
}

export function brainSpoolRoot(base = ensureAutowinAppData()): string {
  const root = join(base, 'brain-trace-spool')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

/** Écrit une trace Brain (append-only, ne jette jamais — l'observabilité n'interrompt pas un run). */
export function appendBrainTrace(trace: BrainTrace, base = ensureAutowinAppData()): void {
  try {
    const redacted: BrainTrace = { ...trace, query: String(redactTrace(trace.query) ?? '') }
    const root = brainSpoolRoot(base)
    const path = join(root, 'events.jsonl')
    if (existsSync(path) && statSync(path).size > SPOOL_MAX_BYTES) {
      renameSync(path, join(root, 'events.previous.jsonl'))
    }
    appendFileSync(path, `${JSON.stringify(redacted)}\n`, 'utf8')
  } catch {
    // best-effort
  }
}

function readFileTraces(path: string): BrainTrace[] {
  if (!existsSync(path)) return []
  const out: BrainTrace[] = []
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue
    try {
      out.push(JSON.parse(line) as BrainTrace)
    } catch {
      // ligne partielle → ignorée
    }
  }
  return out
}

/** Lit les traces Brain (optionnellement filtrées par conversation), les plus récentes d'abord. */
export function readBrainTraces(
  conversationId?: string,
  base = ensureAutowinAppData()
): BrainTrace[] {
  const root = brainSpoolRoot(base)
  const all = [
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ]
  const scoped =
    conversationId === undefined ? all : all.filter((t) => t.conversationId === conversationId)
  return scoped.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}
