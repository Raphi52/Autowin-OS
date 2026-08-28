import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

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

/**
 * ÉCRITURE PAR LOTS — un tour de chat, ce sont ~300 deltas ; un `mkdirSync` + un `appendFileSync`
 * SYNCHRONES par delta bloquaient le process MAIN autant de fois, pendant le streaming.
 *
 * Deux économies, sans rien retirer à la durabilité :
 *  - le dossier de conversation n'est créé QU'UNE fois par tour (mémoire de ce qui a été créé) ;
 *  - les événements NON terminaux s'accumulent dans un tampon vidé par lots (`FLUSH_EVERY`), par un
 *    délai court (`FLUSH_DELAY_MS`), à la RELECTURE du même journal, et — surtout — sur TOUT chemin
 *    terminal (`done`/`error`/`cancelled`/`failed`), qui écrit tampon + événement d'un seul coup.
 *
 * Le prix assumé : un crash brutal dans la fenêtre de tampon peut perdre les derniers deltas d'un
 * tour INACHEVÉ — jamais la clôture, jamais un tour terminé. Même ordre de perte qu'un
 * `appendFileSync` non `fsync`é, et la reprise vise précisément les tours inachevés.
 */
const FLUSH_EVERY = 64
const FLUSH_DELAY_MS = 250
const ensuredDirs = new Set<string>()
const pending = new Map<string, string[]>()
const timers = new Map<string, ReturnType<typeof setTimeout>>()

function ensureDir(dir: string): void {
  // Un dossier effacé sous nos pieds (GC, test) doit être recréé : la mémoire n'est pas une preuve.
  if (ensuredDirs.has(dir) && existsSync(dir)) return
  mkdirSync(dir, { recursive: true })
  ensuredDirs.add(dir)
}

function flushPath(path: string): void {
  const timer = timers.get(path)
  if (timer !== undefined) {
    clearTimeout(timer)
    timers.delete(path)
  }
  const lines = pending.get(path)
  if (!lines || lines.length === 0) return
  pending.delete(path)
  ensureDir(dirname(path))
  appendFileSync(path, lines.join(''), 'utf8')
}

/** Vide le tampon d'un journal sur disque (rien à faire s'il est vide). */
export function flushTurnJournal(root: string, conversationId: string, turnId: string): void {
  flushPath(turnJournalPath(root, conversationId, turnId))
}

/** Vide TOUS les tampons (arrêt de l'app : rien ne doit rester en mémoire). */
export function flushAllTurnJournals(): void {
  for (const path of [...pending.keys()]) flushPath(path)
}

/** Append d'un événement (crée l'arborescence au besoin, écrit par LOTS). */
export function appendTurnEvent(
  root: string,
  conversationId: string,
  turnId: string,
  event: TurnJournalEvent
): void {
  const path = turnJournalPath(root, conversationId, turnId)
  const lines = pending.get(path) ?? []
  lines.push(`${JSON.stringify(event)}\n`)
  pending.set(path, lines)
  if (TERMINAL_KINDS.has(event.kind) || lines.length >= FLUSH_EVERY) {
    flushPath(path)
    return
  }
  if (!timers.has(path)) {
    const timer = setTimeout(() => flushPath(path), FLUSH_DELAY_MS)
    timer.unref?.()
    timers.set(path, timer)
  }
}

/** Relit un journal ; ignore les lignes illisibles (tronquées par un crash). */
export function readTurnJournal(
  root: string,
  conversationId: string,
  turnId: string
): TurnJournalEvent[] {
  const path = turnJournalPath(root, conversationId, turnId)
  // Un tampon non encore vidé fait PARTIE du journal : le relire sans le vider rendrait un tour
  // tronqué à la reprise — le seul coût que le lotissement n'a pas le droit d'avoir.
  flushPath(path)
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
  // Un SCAN de l'arborescence décide de ce qui est inachevé ou obsolète : les tampons encore en
  // mémoire doivent être sur disque AVANT, sinon un tour en vol serait invisible (donc jamais repris).
  flushAllTurnJournals()
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
  // Un SCAN de l'arborescence décide de ce qui est inachevé ou obsolète : les tampons encore en
  // mémoire doivent être sur disque AVANT, sinon un tour en vol serait invisible (donc jamais repris).
  flushAllTurnJournals()
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
      // L'ÂGE d'abord : c'est un statSync, alors que la lecture (flush + readFileSync + JSON.parse
      // ligne à ligne) coûte tout le fichier. Un journal frais n'est JAMAIS ouvert — il ne peut de
      // toute façon pas être supprimé.
      let stale: boolean
      try {
        stale = now - statSync(path).mtimeMs > maxAgeMs
      } catch {
        continue
      }
      if (!stale) continue
      const events = readTurnJournal(root, conversationId, turnId)
      if (isTurnFinished(events)) {
        rmSync(path)
        removed += 1
      }
    }
  }
  return removed
}

/**
 * Supprime TOUS les journaux de tour d'une conversation — appelé quand la conversation elle-même
 * disparaît. Sans cela, un dossier par conversation supprimée restait indéfiniment sur le disque :
 * le GC par âge (`pruneFinishedTurnJournals`) ne descend jamais jusqu'à retirer le dossier vide,
 * et un tour INACHEVÉ d'une conversation supprimée n'aurait de toute façon plus rien à reprendre.
 */
export function removeConversationTurnJournals(root: string, conversationId: string): boolean {
  const dir = join(root, safeSegment(conversationId))
  if (!existsSync(dir)) return false
  rmSync(dir, { recursive: true, force: true })
  return true
}
