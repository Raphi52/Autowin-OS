import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync
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

/** Génération précédente de l'archive : `events.archive.jsonl` → `events.archive.1.jsonl`. */
function previousArchivePath(archivePath: string): string {
  return archivePath.replace(/\.jsonl$/, '.1.jsonl')
}

/**
 * AJOUT EN FIN D'ARCHIVE, JAMAIS RELECTURE-RÉÉCRITURE INTÉGRALE.
 *
 * La version précédente rechargeait TOUTE l'archive (jusqu'à ARCHIVE_MAX_BYTES), y concaténait le
 * segment, puis réécrivait le fichier entier : jusqu'à 10 Mo lus et 8 Mo réécrits pour ajouter
 * quelques kilo-octets, sur le thread principal. L'archive est donc désormais un anneau de DEUX
 * générations, chacune plafonnée à la moitié de ARCHIVE_MAX_BYTES : le plafond global est le même,
 * mais le coût par rotation devient celui du seul segment.
 *
 * La coupe se fait à la frontière d'un FICHIER, donc jamais au milieu d'une ligne JSONL : aucune
 * ligne partielle ne peut subsister en tête. La perte reste bornée à la génération la plus ancienne.
 */
function appendBoundedArchive(archivePath: string, segmentPath: string): void {
  const segmentBytes = existsSync(segmentPath) ? statSync(segmentPath).size : 0
  if (segmentBytes === 0) return
  const currentBytes = existsSync(archivePath) ? statSync(archivePath).size : 0
  if (currentBytes > 0 && currentBytes + segmentBytes > ARCHIVE_MAX_BYTES / 2) {
    renameSync(archivePath, previousArchivePath(archivePath))
  }
  appendFileSync(archivePath, readFileSync(segmentPath))
}

export interface BrainTrace {
  /** Identité de récupération ; absente uniquement sur les traces historiques. */
  id?: string
  timestamp: string
  conversationId: string
  /** Absent uniquement sur les traces historiques antérieures à la corrélation par tour. */
  turnId?: string
  /**
   * NATURE de l'aller-retour Brain. Les trois dernières valeurs sont arrivées le 2026-08-31 avec
   * les appels qu'elles nomment : ils existaient déjà mais n'écrivaient AUCUNE trace, si bien que
   * l'Observatory présentait une chronologie Brain incomplète en la donnant pour complète.
   *  - `automatic`  : contexte préchargé au démarrage d'un run ;
   *  - `query`      : commande `brain_query` explicite du modèle ;
   *  - `empreinte`  : chargement de l'empreinte du dépôt (skill `think`), 1×/run ;
   *  - `recherche`  : recherche lancée par l'HUMAIN depuis la vue Knowledge ;
   *  - `depot`      : ÉCRITURE — dépôt d'un fait en `inbox/` par la commande `remember`.
   */
  kind?: 'automatic' | 'query' | 'empreinte' | 'recherche' | 'depot'
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
    if (
      existsSync(path) &&
      statSync(path).size + Buffer.byteLength(line, 'utf8') > SPOOL_MAX_BYTES
    ) {
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
  } catch (erreur) {
    // Le tracage ne doit JAMAIS casser l'action tracee — mais sa perte est desormais COMPTEE, et
    // lisible par `brainTraceSpoolHealth()` : une chronologie Observatory trouee ne peut plus se
    // presenter comme complete.
    tracesPerdues += 1
    dernierePerte = (erreur instanceof Error ? erreur.message : String(erreur)).slice(0, 500)
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
    // L'archive est un anneau de deux générations : la plus ancienne (`.1`) d'abord.
    ...readFileTraces(join(root, 'events.archive.1.jsonl')),
    ...readFileTraces(join(root, 'events.archive.jsonl')),
    ...readFileTraces(join(root, 'events.previous.jsonl')),
    ...readFileTraces(join(root, 'events.jsonl'))
  ]
  const scoped =
    conversationId === undefined ? all : all.filter((t) => t.conversationId === conversationId)
  return scoped.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))
}
