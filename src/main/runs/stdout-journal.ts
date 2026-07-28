import { closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Journal de SORTIE BRUTE d'un CLI (survie niveau 2, incr. 3) : au lieu de streamer dans un pipe
 * mémoire — perdu dès que l'app meurt — le process écrit sa stdout dans un FICHIER, et l'app SUIT
 * ce fichier (tail). Conséquences : (a) un CLI spawné détaché continue d'écrire pendant que l'app
 * est fermée, (b) au redémarrage on relit tout ce qui a été produit entre-temps.
 *
 * Le tail est volontairement basé sur un POLL de position (pas fs.watch) : robuste au partage
 * réseau, aux réécritures et aux plateformes où watch est capricieux. Une ligne partielle (écriture
 * en cours) est conservée en tampon jusqu'à réception de son `\n` — jamais parsée à moitié.
 */

export interface StdoutJournalHandle {
  path: string
  /** fd ouvert en append, à passer dans `stdio` du spawn puis à fermer côté parent. */
  fd: number
}

export function stdoutJournalPath(root: string, runId: string): string {
  const safe = runId.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120)
  if (!safe || safe === '.' || safe === '..') throw new Error('identifiant de run invalide')
  return join(root, `${safe}.stdout.jsonl`)
}

/** Ouvre (crée) le journal de sortie d'un run et rend son fd append pour `stdio`. */
export function openStdoutJournal(root: string, runId: string): StdoutJournalHandle {
  mkdirSync(root, { recursive: true })
  const path = stdoutJournalPath(root, runId)
  return { path, fd: openSync(path, 'a') }
}

export interface TailOptions {
  /** Offset de départ (reprise après redémarrage : on repart d'où on s'était arrêté). */
  from?: number
  /** Intervalle de poll ; borné court pour rester réactif sans brûler le CPU. */
  pollMs?: number
  /** Arrêt : renvoie true quand il n'y a plus rien à attendre (process fini ET fichier lu). */
  isComplete?: () => boolean
  signal?: AbortSignal
}

export interface TailResult {
  /** Offset atteint — à repersister pour une reprise ultérieure. */
  offset: number
  /** Vrai si on s'est arrêté parce que `isComplete`/signal l'a demandé. */
  stopped: boolean
}

/** Lit les octets disponibles depuis `offset` (lecture bornée, sans charger tout le fichier). */
export function readChunkFrom(path: string, offset: number, maxBytes = 1_000_000): { text: string; next: number } {
  if (!existsSync(path)) return { text: '', next: offset }
  const size = statSync(path).size
  if (size <= offset) return { text: '', next: offset }
  const length = Math.min(size - offset, maxBytes)
  const buffer = Buffer.allocUnsafe(length)
  const fd = openSync(path, 'r')
  try {
    const read = readSync(fd, buffer, 0, length, offset)
    return { text: buffer.subarray(0, read).toString('utf8'), next: offset + read }
  } finally {
    closeSync(fd)
  }
}

/**
 * Découpe un flux en LIGNES COMPLÈTES : renvoie les lignes terminées + le reste partiel à garder
 * pour le prochain tour (le CLI peut être interrompu au milieu d'une ligne).
 */
export function splitCompleteLines(buffered: string): { lines: string[]; rest: string } {
  const parts = buffered.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter((line) => line.trim().length > 0), rest }
}

/**
 * Suit le journal et livre chaque ligne complète à `onLine`. S'arrête quand `isComplete()` est vrai
 * (après avoir drainé ce qui restait) ou sur abort. Rend l'offset atteint pour une reprise.
 */
export async function tailJsonLines(
  path: string,
  onLine: (line: string) => void,
  options: TailOptions = {}
): Promise<TailResult> {
  const pollMs = Math.min(Math.max(options.pollMs ?? 120, 20), 500)
  let offset = options.from ?? 0
  let buffered = ''
  for (;;) {
    if (options.signal?.aborted) return { offset, stopped: true }
    const { text, next } = readChunkFrom(path, offset)
    offset = next
    if (text) {
      buffered += text
      const { lines, rest } = splitCompleteLines(buffered)
      buffered = rest
      for (const line of lines) onLine(line)
    }
    // Fin : on drainait déjà ci-dessus, donc si le producteur a fini ET qu'il ne reste rien → stop.
    if (options.isComplete?.()) {
      const tailEnd = readChunkFrom(path, offset)
      offset = tailEnd.next
      if (tailEnd.text) {
        const { lines, rest } = splitCompleteLines(buffered + tailEnd.text)
        buffered = rest
        for (const line of lines) onLine(line)
      }
      if (buffered.trim()) onLine(buffered.trim()) // dernière ligne sans `\n` (process tué net)
      return { offset, stopped: false }
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs)) // sleep-ok: poll borné ≤500ms
  }
}
