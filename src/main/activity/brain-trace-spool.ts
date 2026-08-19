import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
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
const ARCHIVE_MAX_BYTES = 8 * 1024 * 1024
const MAX_QUERY_CHARS = 16_000
const MAX_ENTRY_BYTES = 512 * 1024
const latestTraceIds = new Map<string, string>()

/** Sante du spool Brain, lisible sans jamais jeter. `enBonneSante` est faux des la premiere perte. */
export interface SanteSpoolBrain {
  tracesPerdues: number
  derniereErreur?: string
  enBonneSante: boolean
}

// Le tracage ne doit jamais casser l'action tracee, mais sa perte ne doit pas etre invisible :
// un spool totalement mort se lisait comme un spool vide, et l'Observatory presentait une
// chronologie incomplete en la donnant pour complete. Meme parti pris que TraceLedger.sante().
let tracesPerdues = 0
let dernierePerte: string | undefined

/** Etat du spool de traces Brain (compteurs de perte), lisible sans jamais jeter. */
export function brainTraceSpoolHealth(): SanteSpoolBrain {
  return {
    tracesPerdues,
    ...(dernierePerte ? { derniereErreur: dernierePerte } : {}),
    enBonneSante: tracesPerdues === 0
  }
}

function correlationKey(base: string, conversationId: string, turnId: string): string {
  return `${resolve(base)}\u0000${conversationId}\u0000${turnId}`
}

function boundedRedactedTrace(trace: BrainTrace): BrainTrace {
  const query = String(redactTrace(trace.query) ?? '').slice(0, MAX_QUERY_CHARS)
  const navigation = trace.navigation
    ? {
        ...trace.navigation,
        query: String(redactTrace(trace.navigation.query) ?? '').slice(0, MAX_QUERY_CHARS),
        root: trace.navigation.root?.slice(0, 4_096),
        candidates: trace.navigation.candidates.slice(0, 100).map((candidate) => ({
          ...candidate,
          path: candidate.path.slice(0, 4_096),
          type: candidate.type.slice(0, 256),
          relations: candidate.relations
            ?.slice(0, 20)
            .map((relation) => ({ ...relation, target: relation.target.slice(0, 4_096) }))
        }))
      }
    : undefined
  const bounded: BrainTrace = { ...trace, query, ...(navigation ? { navigation } : {}) }
  if (Buffer.byteLength(JSON.stringify(bounded), 'utf8') <= MAX_ENTRY_BYTES) return bounded
  // La navigation est reconstructible depuis Brain. L'identite, l'issue et les compteurs du run ne
  // le sont pas : on conserve ceux-ci plutot que de laisser une entree geante casser la retention.
  delete bounded.navigation
  return bounded
}

function appendBoundedArchive(archivePath: string, segmentPath: string): void {
  const existing = existsSync(archivePath) ? readFileSync(archivePath) : Buffer.alloc(0)
  const segment = readFileSync(segmentPath)
  let retained = Buffer.concat([existing, segment])
  if (retained.length > ARCHIVE_MAX_BYTES) {
    retained = retained.subarray(retained.length - ARCHIVE_MAX_BYTES)
    // Une coupe au milieu d'une ligne JSONL créerait une fausse corruption à la lecture. La
    // première ligne partielle est donc sacrifiée ; toutes les suivantes restent exactes.
    const firstNewline = retained.indexOf(0x0a)
    retained = firstNewline >= 0 ? retained.subarray(firstNewline + 1) : Buffer.alloc(0)
  }
  writeFileSync(archivePath, retained)
}

export interface BrainTrace {
  /** Identité de récupération ; absente uniquement sur les traces historiques. */
  id?: string
  timestamp: string
  conversationId: string
  /** Absent uniquement sur les traces historiques antérieures à la corrélation par tour. */
  turnId?: string
  /** `automatic` = contexte préchargé par un run ; `query` = commande explicite du modèle. */
  kind?: 'automatic' | 'query'
  query: string
  found?: boolean
  status?: 'found' | 'empty' | 'invalid' | 'unavailable'
  injectedChars: number
  navigation?: BrainNavigation
}

export function brainSpoolRoot(base = ensureAutowinAppData()): string {
  const root = join(base, 'brain-trace-spool')
  if (!existsSync(root)) mkdirSync(root, { recursive: true })
  return root
}

/** Écrit une trace Brain (append-only, ne jette jamais — l'observabilité n'interrompt pas un run). */
export function appendBrainTrace(
  trace: BrainTrace,
  base = ensureAutowinAppData()
): BrainTrace | undefined {
  try {
    const identified = trace.id ? trace : { ...trace, id: randomUUID() }
    const redacted = boundedRedactedTrace(identified)
    const line = `${JSON.stringify(redacted)}\n`
    const root = brainSpoolRoot(base)
    const path = join(root, 'events.jsonl')
    if (existsSync(path) && statSync(path).size + Buffer.byteLength(line, 'utf8') > SPOOL_MAX_BYTES) {
      const previous = join(root, 'events.previous.jsonl')
      if (existsSync(previous)) {
        appendBoundedArchive(join(root, 'events.archive.jsonl'), previous)
        rmSync(previous, { force: true })
      }
      renameSync(path, previous)
    }
    appendFileSync(path, line, 'utf8')
    if (redacted.id && redacted.turnId) {
      latestTraceIds.set(
        correlationKey(base, redacted.conversationId, redacted.turnId),
        redacted.id
      )
    }
    return redacted
  } catch {
    // best-effort
    return undefined
  }
}

/** Identité de la récupération la plus récente émise dans ce tour, au moment d'un appel provider. */
export function latestBrainTraceId(
  conversationId: string,
  turnId: string,
  base = ensureAutowinAppData()
): string | undefined {
  return latestTraceIds.get(correlationKey(base, conversationId, turnId))
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
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ]
  const scoped =
    conversationId === undefined ? all : all.filter((t) => t.conversationId === conversationId)
  return scoped.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}
