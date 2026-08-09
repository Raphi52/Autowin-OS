import {
  appendFileSync,
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync
} from 'node:fs'
import { join, resolve } from 'node:path'
import { assertTraceEvent, type TraceEventV1 } from './trace-event'

export type TraceEventSink = (event: TraceEventV1) => void

let installedTraceEventSink: TraceEventSink | undefined
// Tous les producteurs de trace d'Autowin vivent dans le meme main Electron. Ce registre partage
// l'allocation entre instances de TraceStore ; le journal disque reste l'autorite au redemarrage.
const allocatedSequences = new Map<string, number>()
const sequenceLockWaitBuffer = new Int32Array(new SharedArrayBuffer(4))
const SEQUENCE_LOCK_TIMEOUT_MS = 2_000
const STALE_SEQUENCE_LOCK_MS = 30_000

function withSequenceLock<T>(root: string, conversationId: string, action: () => T): T {
  mkdirSync(root, { recursive: true })
  const lockPath = join(root, `.${conversationId}.sequence.lock`)
  const deadline = Date.now() + SEQUENCE_LOCK_TIMEOUT_MS
  let descriptor: number | undefined
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lockPath, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      try {
        if (Date.now() - statSync(lockPath).mtimeMs > STALE_SEQUENCE_LOCK_MS) {
          rmSync(lockPath, { force: true })
          continue
        }
      } catch (statError) {
        if ((statError as NodeJS.ErrnoException).code === 'ENOENT') continue
        throw statError
      }
      if (Date.now() >= deadline) throw new Error('allocation de sequence verrouillee trop longtemps')
      Atomics.wait(sequenceLockWaitBuffer, 0, 0, 2)
    }
  }
  try {
    return action()
  } finally {
    closeSync(descriptor)
    rmSync(lockPath, { force: true })
  }
}

/** Installe une sortie best-effort globale pour les vues dérivées/exporteurs, jamais pour la durabilité. */
export function installTraceEventSink(sink: TraceEventSink): () => void {
  const previous = installedTraceEventSink
  installedTraceEventSink = sink
  return () => {
    if (installedTraceEventSink === sink) installedTraceEventSink = previous
  }
}

export class TraceStore {
  private readonly ids = new Map<string, Set<string>>()
  private readonly descriptors = new Map<string, number>()
  private readonly lastSequences = new Map<string, number>()
  private readonly sequenceCursors = new Map<
    string,
    { offset: number; mtimeMs: number; lastSequence: number }
  >()
  private scannedSequenceBytes = 0

  constructor(private readonly root: string) {}

  private path(conversationId: string): string {
    if (!/^[a-zA-Z0-9_-]+$/.test(conversationId)) throw new Error('conversationId invalide')
    return join(this.root, `${conversationId}.jsonl`)
  }

  private sequenceKey(conversationId: string): string {
    return `${resolve(this.root)}\0${conversationId}`
  }

  private reserveSequence(conversationId: string, candidate: number): number {
    const key = this.sequenceKey(conversationId)
    const counterPath = join(this.root, `.${conversationId}.sequence`)
    return withSequenceLock(this.root, conversationId, () => {
      let persisted = -1
      if (existsSync(counterPath)) {
        const parsed = Number.parseInt(readFileSync(counterPath, 'utf8').trim(), 10)
        if (Number.isSafeInteger(parsed) && parsed >= 0) persisted = parsed
      }
      const sequence = Math.max(candidate, persisted + 1, (allocatedSequences.get(key) ?? -1) + 1)
      writeFileSync(counterPath, String(sequence), 'utf8')
      allocatedSequences.set(key, sequence)
      return sequence
    })
  }

  append(event: TraceEventV1): this {
    assertTraceEvent(event)
    const existing = this.ids.has(event.conversationId)
      ? undefined
      : this.readConversation(event.conversationId)
    const seen = this.ids.get(event.conversationId) ?? new Set(existing!.map((x) => x.id))
    if (seen.has(event.id)) throw new Error(`événement dupliqué: ${event.id}`)
    const lastSequence =
      this.lastSequences.get(event.conversationId) ??
      (existing?.length ? existing[existing.length - 1].sequence : -1)
    if (event.sequence <= lastSequence)
      throw new Error(`sequence non monotone: ${event.sequence} <= ${lastSequence}`)
    if (event.parentId && !seen.has(event.parentId))
      throw new Error(`parent causal introuvable: ${event.parentId}`)
    mkdirSync(this.root, { recursive: true })
    const descriptor =
      this.descriptors.get(event.conversationId) ?? openSync(this.path(event.conversationId), 'a')
    this.descriptors.set(event.conversationId, descriptor)
    writeSync(descriptor, `${JSON.stringify(event)}\n`, undefined, 'utf8')
    seen.add(event.id)
    this.ids.set(event.conversationId, seen)
    this.lastSequences.set(event.conversationId, event.sequence)
    const allocationKey = this.sequenceKey(event.conversationId)
    allocatedSequences.set(
      allocationKey,
      Math.max(allocatedSequences.get(allocationKey) ?? -1, event.sequence)
    )
    try {
      installedTraceEventSink?.(structuredClone(event))
    } catch {
      // Une projection ou une télémétrie optionnelle ne devient jamais une dépendance du run.
    }
    return this
  }

  readConversation(conversationId: string): TraceEventV1[] {
    const path = this.path(conversationId)
    if (!existsSync(path)) return []
    const out: TraceEventV1[] = []
    const lines = readFileSync(path, 'utf8').split(/\r?\n/)
    const lastContentIndex = lines.reduce((last, line, index) => (line ? index : last), -1)
    for (const [index, line] of lines.entries()) {
      if (!line) continue
      try {
        const event = assertTraceEvent(JSON.parse(line) as TraceEventV1)
        if (event.conversationId === conversationId) out.push(event)
      } catch (error) {
        if (index === lastContentIndex && error instanceof SyntaxError) continue
        throw new Error(`trace corrompue ligne ${index + 1}`, { cause: error })
      }
    }
    return out.sort((a, b) => a.sequence - b.sequence)
  }

  /** Lecture reservee aux vues derivees : ignore chaque entree invalide sans masquer la corruption canonique. */
  readConversationBestEffort(conversationId: string): TraceEventV1[] {
    const path = this.path(conversationId)
    if (!existsSync(path)) return []
    const out: TraceEventV1[] = []
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      if (!line) continue
      try {
        const event = assertTraceEvent(JSON.parse(line) as TraceEventV1)
        if (event.conversationId === conversationId) out.push(event)
      } catch {
        // Une vue reconstruisible peut rester partielle ; la lecture canonique demeure fail-closed.
      }
    }
    return out.sort((a, b) => a.sequence - b.sequence)
  }

  nextSequence(conversationId: string): number {
    const path = this.path(conversationId)
    if (!existsSync(path)) {
      this.sequenceCursors.set(conversationId, { offset: 0, mtimeMs: 0, lastSequence: -1 })
      this.lastSequences.delete(conversationId)
      return this.reserveSequence(conversationId, 0)
    }

    const stats = statSync(path)
    const cursor = this.sequenceCursors.get(conversationId)
    if (!cursor)
      return this.reserveSequence(
        conversationId,
        this.warmSequenceCursor(conversationId, path, stats.mtimeMs)
      )

    if (stats.size === cursor.offset && stats.mtimeMs === cursor.mtimeMs) {
      return this.reserveSequence(
        conversationId,
        Math.max(cursor.lastSequence, this.lastSequences.get(conversationId) ?? -1) + 1
      )
    }
    if (stats.size < cursor.offset || stats.size === cursor.offset) {
      return this.reserveSequence(
        conversationId,
        this.warmSequenceCursor(conversationId, path, stats.mtimeMs)
      )
    }

    const suffix = Buffer.allocUnsafe(stats.size - cursor.offset)
    const descriptor = openSync(path, 'r')
    let bytesRead = 0
    try {
      while (bytesRead < suffix.length) {
        const read = readSync(
          descriptor,
          suffix,
          bytesRead,
          suffix.length - bytesRead,
          cursor.offset + bytesRead
        )
        if (read === 0) break
        bytesRead += read
      }
    } finally {
      closeSync(descriptor)
    }
    const availableSuffix = suffix.subarray(0, bytesRead)
    this.scannedSequenceBytes += bytesRead
    const completeBytes = availableSuffix.lastIndexOf(0x0a) + 1
    const lastSequence = this.scanSequenceLines(
      conversationId,
      availableSuffix.subarray(0, completeBytes),
      cursor.lastSequence
    )
    const nextCursor = {
      offset: cursor.offset + completeBytes,
      mtimeMs: stats.mtimeMs,
      lastSequence
    }
    this.sequenceCursors.set(conversationId, nextCursor)
    this.lastSequences.set(conversationId, lastSequence)
    return this.reserveSequence(conversationId, lastSequence + 1)
  }

  /** Octets réellement inspectés par `nextSequence`, exposés pour la garde de complexité. */
  get sequenceScanBytes(): number {
    return this.scannedSequenceBytes
  }

  private warmSequenceCursor(conversationId: string, path: string, mtimeMs: number): number {
    const content = readFileSync(path)
    this.scannedSequenceBytes += content.length
    const completeBytes = content.lastIndexOf(0x0a) + 1
    const lastSequence = this.scanSequenceLines(
      conversationId,
      content.subarray(0, completeBytes),
      -1
    )
    this.sequenceCursors.set(conversationId, {
      offset: completeBytes,
      mtimeMs,
      lastSequence
    })
    this.lastSequences.set(conversationId, lastSequence)
    return lastSequence + 1
  }

  private scanSequenceLines(
    conversationId: string,
    content: Buffer,
    initialSequence: number
  ): number {
    let lastSequence = initialSequence
    for (const line of content.toString('utf8').split(/\r?\n/)) {
      if (!line) continue
      try {
        const event = assertTraceEvent(JSON.parse(line) as TraceEventV1)
        if (event.conversationId === conversationId) {
          lastSequence = Math.max(lastSequence, event.sequence)
        }
      } catch (error) {
        throw new Error('trace corrompue pendant allocation de sequence', { cause: error })
      }
    }
    return lastSequence
  }

  exportConversation(conversationId: string): TraceEventV1[] {
    return this.readConversation(conversationId)
  }
  importConversation(events: TraceEventV1[]): this {
    for (const event of events) this.append(event)
    return this
  }
  deleteConversation(conversationId: string): boolean {
    const path = this.path(conversationId)
    if (!existsSync(path)) return false
    const descriptor = this.descriptors.get(conversationId)
    if (descriptor !== undefined) {
      closeSync(descriptor)
      this.descriptors.delete(conversationId)
    }
    rmSync(path)
    this.ids.delete(conversationId)
    this.lastSequences.delete(conversationId)
    this.sequenceCursors.delete(conversationId)
    allocatedSequences.delete(this.sequenceKey(conversationId))
    rmSync(join(this.root, `.${conversationId}.sequence`), { force: true })
    return true
  }
  appendRawForRecoveryTest(line: string): void {
    mkdirSync(this.root, { recursive: true })
    appendFileSync(this.path('conv-1'), line, 'utf8')
  }
}

/**
 * Resynchronise un producteur qui a pu attendre pendant qu'un run imbrique écrivait dans la même
 * conversation. La séquence proposée reste valable si aucun autre producteur ne l'a dépassée.
 */
export function rebaseTraceSequence(
  store: TraceStore,
  conversationId: string,
  proposedSequence: number
): number {
  return Math.max(proposedSequence, store.nextSequence(conversationId))
}
