import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Journal de TOUR (append-only, une ligne JSON par événement) — socle de la survie niveau 2 :
 * la sortie d'un run vit dans un FICHIER, pas seulement dans un pipe mémoire. L'app peut donc
 * REJOUER au démarrage ce qui a été produit pendant qu'elle était fermée, et repérer les tours
 * restés inachevés (aucun `done`/`cancelled` écrit).
 *
 * Robustesse assumée : un crash en pleine écriture laisse une ligne tronquée → la relecture IGNORE
 * les lignes illisibles au lieu d'échouer (sinon un octet corrompu perdrait tout le tour).
 */

export interface TurnJournalEvent {
  /** Type d'événement (delta, command, result, done, cancelled…). */
  kind: string
  [key: string]: unknown
}

export interface UnfinishedTurn {
  conversationId: string
  turnId: string
  events: number
  updatedAt: number
}

/**
 * Événements qui CLÔTURENT un tour : leur présence signifie « rien à reprendre ».
 *
 * `failed` est le vocabulaire du STORE (`applyTurnEvent`), `error` celui du flux d'événements du
 * pilote. Les deux doivent figurer ici : un tour échoué dont le journal porte `failed` restait sinon
 * « inachevé » à jamais et la reprise automatique le rejouait à chaque démarrage — un tour ZOMBIE
 * (constaté en réel le 2026-07-29 sur une erreur d'API répétée).
 */
const TERMINAL_KINDS = new Set(['done', 'cancelled', 'error', 'failed'])

/** Nom de fichier sûr (un id de conversation/tour ne doit jamais s'échapper du dossier). */
function safeSegment(value: string): string {
  const cleaned = value.replace(/[^A-Za-z0-9._-]/g, '_')
  if (!cleaned || cleaned === '.' || cleaned === '..') throw new Error('identifiant de journal invalide')
  return cleaned.slice(0, 120)
}

export function turnJournalPath(root: string, conversationId: string, turnId: string): string {
  return join(root, safeSegment(conversationId), `${safeSegment(turnId)}.jsonl`)
}

/** Append d'un événement (crée l'arborescence au besoin). */
export function appendTurnEvent(
  root: string,
  conversationId: string,
  turnId: string,
  event: TurnJournalEvent
): void {
  const path = turnJournalPath(root, conversationId, turnId)
  mkdirSync(join(root, safeSegment(conversationId)), { recursive: true })
  appendFileSync(path, `${JSON.stringify(event)}\n`, 'utf8')
}

/** Relit un journal ; ignore les lignes illisibles (tronquées par un crash). */
export function readTurnJournal(
  root: string,
  conversationId: string,
  turnId: string
): TurnJournalEvent[] {
  const path = turnJournalPath(root, conversationId, turnId)
  if (!existsSync(path)) return []
  const out: TurnJournalEvent[] = []
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as TurnJournalEvent
      if (parsed && typeof parsed === 'object' && typeof parsed.kind === 'string') out.push(parsed)
    } catch {
      // ligne tronquée/corrompue → on saute, le reste du tour reste exploitable
    }
  }
  return out
}

/** Un tour est TERMINÉ si son journal contient un événement terminal. */
export function isTurnFinished(events: readonly TurnJournalEvent[]): boolean {
  return events.some((event) => TERMINAL_KINDS.has(event.kind))
}

/**
 * Tours restés INACHEVÉS (à rejouer/reprendre au démarrage), les plus récents d'abord.
 * Racine absente → [] (aucun journal, comportement historique).
 */
export function listUnfinishedTurns(root: string): UnfinishedTurn[] {
  if (!existsSync(root)) return []
  const found: UnfinishedTurn[] = []
  for (const conversationId of readdirSync(root)) {
    const dir = join(root, conversationId)
    let entries: string[]
    try {
      if (!statSync(dir).isDirectory()) continue
      entries = readdirSync(dir)
    } catch {
      continue
    }
    for (const file of entries) {
      if (!file.endsWith('.jsonl')) continue
      const turnId = file.slice(0, -'.jsonl'.length)
      const events = readTurnJournal(root, conversationId, turnId)
      if (events.length === 0 || isTurnFinished(events)) continue
      found.push({
        conversationId,
        turnId,
        events: events.length,
        updatedAt: statSync(join(dir, file)).mtimeMs
      })
    }
  }
  return found.sort((a, b) => b.updatedAt - a.updatedAt)
}

/**
 * GC : supprime les journaux TERMINÉS plus vieux que `maxAgeMs` (défaut 7 j). Ne touche jamais un
 * tour inachevé (c'est précisément ce qu'on veut pouvoir reprendre). Renvoie le nombre supprimé.
 */
export function pruneFinishedTurnJournals(root: string, maxAgeMs = 7 * 24 * 3_600_000, now = Date.now()): number {
  if (!existsSync(root)) return 0
  let removed = 0
  for (const conversationId of readdirSync(root)) {
    const dir = join(root, conversationId)
    try {
      if (!statSync(dir).isDirectory()) continue
    } catch {
      continue
    }
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.jsonl')) continue
      const path = join(dir, file)
      const turnId = file.slice(0, -'.jsonl'.length)
      const events = readTurnJournal(root, conversationId, turnId)
      const stale = now - statSync(path).mtimeMs > maxAgeMs
      if (stale && isTurnFinished(events)) {
        rmSync(path)
        removed += 1
      }
    }
  }
  return removed
}
